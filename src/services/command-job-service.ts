import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  createAuditEvent,
  evaluateWorkspaceOperationPolicy,
  RunnerOperationDeniedError,
  type RunnerSecurityServices,
  type SecurityActor,
} from "../security/index.ts";
import type { DiagnosticsLogger } from "../adapters/logging/index.ts";
import { NoopDiagnosticsLogger } from "../adapters/logging/index.ts";
import {
  PROCESS_RUNNER_DEFAULT_LIMITS,
  type ProcessFailureKind,
  type ProcessRunner,
  type ProcessRunnerResult,
} from "../adapters/process/index.ts";
import type { JobQueue } from "../adapters/queue/index.ts";
import {
  commandJobSchema,
  createQueuedCommandJobModel,
  toolError,
  type CommandFailureKind,
  type CommandJob,
  type ToolFailure,
  type Workspace,
} from "../domain/index.ts";
import { WorkspacePathBoundaryError } from "../filesystem/workspace-paths.ts";
import type { CommandJobStore } from "../storage/in-memory-command-job-store.ts";
import { InMemoryCommandJobStore } from "../storage/in-memory-command-job-store.ts";
import { LocalWorkspaceFilesystem } from "./local-workspace-filesystem.ts";
import { type Clock, type WorkspaceRegistry } from "./workspace-registry.ts";
import type { WorkspaceLifecycleService } from "./workspace-lifecycle-service.ts";

export const COMMAND_JOB_DEFAULT_LIMITS = {
  timeoutMs: 120_000,
  maxOutputBytes: 1_000_000,
} as const;

export const COMMAND_JOB_HARD_LIMITS = {
  timeoutMs: 10 * 60_000,
  maxOutputBytes: PROCESS_RUNNER_DEFAULT_LIMITS.maxStdoutBytes,
} as const;

export const COMMAND_JOB_ERROR_CODES = {
  invalidInput: "invalid_input",
  workspaceNotFound: "workspace_not_found",
  workspaceUnavailable: "workspace_unavailable",
  operationDenied: "operation_denied",
  jobNotFound: "job_not_found",
  workspaceMismatch: "workspace_mismatch",
  invalidCwd: "invalid_cwd",
  timeoutExceedsPolicy: "timeout_exceeds_policy",
  commandQueueFailed: "command_queue_failed",
  commandStatusFailed: "command_status_failed",
} as const;

export type CommandJobErrorCode =
  (typeof COMMAND_JOB_ERROR_CODES)[keyof typeof COMMAND_JOB_ERROR_CODES];

export class CommandJobServiceError extends Error {
  readonly code: CommandJobErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: CommandJobErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "CommandJobServiceError";
    this.code = code;
    this.details = details;
  }
}

export type CommandJobIdFactory = () => string;

export type CommandJobServiceOptions = {
  workspaceRegistry: WorkspaceRegistry;
  workspaceFilesystem: LocalWorkspaceFilesystem;
  security: RunnerSecurityServices;
  processRunner: ProcessRunner;
  jobQueue: JobQueue;
  jobStore?: CommandJobStore;
  workspaceLifecycleService?: WorkspaceLifecycleService;
  diagnosticsLogger?: DiagnosticsLogger;
  clock?: Clock;
  createJobId?: CommandJobIdFactory;
};

export type RunCommandRequest = {
  workspaceId: string;
  command: readonly string[];
  cwd?: string;
  timeoutMs: number;
  actor?: SecurityActor;
};

export type GetCommandStatusRequest = {
  workspaceId: string;
  jobId: string;
  actor?: SecurityActor;
};

export class CommandJobService {
  readonly #workspaceRegistry: WorkspaceRegistry;
  readonly #workspaceFilesystem: LocalWorkspaceFilesystem;
  readonly #security: RunnerSecurityServices;
  readonly #processRunner: ProcessRunner;
  readonly #jobQueue: JobQueue;
  readonly #jobStore: CommandJobStore;
  readonly #workspaceLifecycleService: WorkspaceLifecycleService | null;
  readonly #diagnosticsLogger: DiagnosticsLogger;
  readonly #clock: Clock;
  readonly #createJobId: CommandJobIdFactory;

  constructor({
    workspaceRegistry,
    workspaceFilesystem,
    security,
    processRunner,
    jobQueue,
    jobStore = new InMemoryCommandJobStore(),
    workspaceLifecycleService,
    diagnosticsLogger = new NoopDiagnosticsLogger(),
    clock = () => new Date(),
    createJobId = createCommandJobId,
  }: CommandJobServiceOptions) {
    this.#workspaceRegistry = workspaceRegistry;
    this.#workspaceFilesystem = workspaceFilesystem;
    this.#security = security;
    this.#processRunner = processRunner;
    this.#jobQueue = jobQueue;
    this.#jobStore = jobStore;
    this.#workspaceLifecycleService = workspaceLifecycleService ?? null;
    this.#diagnosticsLogger = diagnosticsLogger;
    this.#clock = clock;
    this.#createJobId = createJobId;
  }

  get jobStore(): CommandJobStore {
    return this.#jobStore;
  }

  async runCommand(input: RunCommandRequest): Promise<CommandJob> {
    const workspace = this.#requireReadyWorkspace(input.workspaceId);
    const command = [...input.command];
    const policy = this.#security.createWorkspacePolicy(workspace);
    const timeoutMs = validateTimeout(input.timeoutMs, policy.command.timeoutMs);
    const maxOutputBytes = Math.min(policy.command.maxOutputBytes, COMMAND_JOB_HARD_LIMITS.maxOutputBytes);
    const cwd = this.#resolveCwd(workspace.workspaceId, input.cwd);
    const operation = {
      workspaceId: workspace.workspaceId,
      operationKind: "command",
      action: "run_command",
      actor: input.actor ?? "assistant",
      command,
      ...(cwd.relativePath === null ? {} : { relativePath: cwd.relativePath }),
      metadata: {
        cwd: cwd.displayPath,
        timeoutMs,
        maxOutputBytes,
        commandArgc: command.length,
      },
    } as const;
    const policyDecision = evaluateWorkspaceOperationPolicy(policy, operation);

    await this.#recordAudit({
      operation,
      eventType: "policy_evaluated",
      decision: policyDecision,
    });

    if (policyDecision.outcome === "denied") {
      await this.#recordAudit({
        operation,
        eventType: "operation_denied",
        decision: policyDecision,
      });
      throw new RunnerOperationDeniedError(policyDecision, operation);
    }

    const job = this.#jobStore.save(createQueuedCommandJobModel({
      jobId: this.#createJobId(),
      workspaceId: workspace.workspaceId,
      command,
      cwd: cwd.displayPath,
      timeoutMs,
    }, { now: this.#clock() }));

    this.#diagnosticsLogger.info("Command job queued.", {
      jobId: job.jobId,
      workspaceId: job.workspaceId,
      cwd: job.cwd,
      timeoutMs: job.timeoutMs,
      command: job.command,
    });

    void this.#jobQueue.add(
      () => this.#executeQueuedJob({
        jobId: job.jobId,
        operation,
        cwdAbsolutePath: cwd.absolutePath,
        maxOutputBytes,
      }),
      { workspaceId: workspace.workspaceId },
    ).catch((error) => {
      this.#handleQueueFailure(job.jobId, error);
    });

    return job;
  }

  async getCommandStatus(input: GetCommandStatusRequest): Promise<CommandJob> {
    const workspace = this.#requireExistingWorkspace(input.workspaceId);
    const operation = {
      workspaceId: workspace.workspaceId,
      operationKind: "command",
      action: "get_command_status",
      actor: input.actor ?? "assistant",
      metadata: { jobId: input.jobId },
    } as const;
    const policy = this.#security.createWorkspacePolicy(workspace);

    try {
      const decision = evaluateWorkspaceOperationPolicy(policy, operation);
      await this.#recordAudit({ operation, eventType: "policy_evaluated", decision });

      if (decision.outcome === "denied") {
        await this.#recordAudit({ operation, eventType: "operation_denied", decision });
        throw new RunnerOperationDeniedError(decision, operation);
      }

      await this.#recordAudit({ operation, eventType: "operation_started", decision });
      const job = this.#jobStore.get(input.jobId);
      if (job === null) {
        throw new CommandJobServiceError(
          COMMAND_JOB_ERROR_CODES.jobNotFound,
          "Command job not found.",
          { workspaceId: workspace.workspaceId, jobId: input.jobId },
        );
      }

      if (job.workspaceId !== workspace.workspaceId) {
        throw new CommandJobServiceError(
          COMMAND_JOB_ERROR_CODES.workspaceMismatch,
          "Command job belongs to a different workspace.",
          { workspaceId: workspace.workspaceId, jobId: input.jobId, jobWorkspaceId: job.workspaceId },
        );
      }

      await this.#recordAudit({ operation, eventType: "operation_succeeded", decision });
      return job;
    } catch (error) {
      if (error instanceof CommandJobServiceError) {
        await this.#recordAudit({
          operation,
          eventType: "operation_failed",
          message: error.message,
          metadata: { code: error.code, ...error.details },
        });
      }
      throw toCommandJobServiceError(error, workspace.workspaceId);
    }
  }

  async #executeQueuedJob({
    jobId,
    operation,
    cwdAbsolutePath,
    maxOutputBytes,
  }: {
    jobId: string;
    operation: Parameters<typeof createAuditEvent>[0]["operation"];
    cwdAbsolutePath: string;
    maxOutputBytes: number;
  }): Promise<void> {
    const queuedJob = this.#jobStore.get(jobId);
    if (queuedJob === null) {
      return;
    }

    const startedAt = this.#clock();
    const runningJob = this.#saveJob({
      ...queuedJob,
      status: "running",
      startedAt: startedAt.toISOString(),
      updatedAt: startedAt.toISOString(),
    });

    this.#workspaceLifecycleService?.markBusy(runningJob.workspaceId);
    await this.#recordAudit({
      operation,
      eventType: "operation_started",
      decision: { outcome: "allowed", message: "Command job execution started." },
      metadata: {
        jobId,
        cwd: runningJob.cwd,
        timeoutMs: runningJob.timeoutMs,
      },
    });
    this.#diagnosticsLogger.info("Command job started.", {
      jobId,
      workspaceId: runningJob.workspaceId,
      cwd: runningJob.cwd,
      timeoutMs: runningJob.timeoutMs,
      command: runningJob.command,
    });

    try {
      const result = await this.#processRunner.run({
        executable: runningJob.command[0] ?? "",
        args: runningJob.command.slice(1),
        cwd: cwdAbsolutePath,
        timeoutMs: runningJob.timeoutMs,
        maxStdoutBytes: maxOutputBytes,
        maxStderrBytes: maxOutputBytes,
      });
      const terminalJob = this.#saveTerminalJob(runningJob, result);
      const terminalMetadata = commandJobAuditMetadata(terminalJob);

      if (terminalJob.status === "succeeded") {
        await this.#recordAudit({
          operation,
          eventType: "operation_succeeded",
          decision: { outcome: "allowed", message: "Command job completed successfully." },
          metadata: terminalMetadata,
        });
        this.#diagnosticsLogger.info("Command job succeeded.", terminalMetadata);
      } else {
        await this.#recordAudit({
          operation,
          eventType: "operation_failed",
          decision: { outcome: "allowed", message: "Command job reached a failed terminal state." },
          message: `Command job ${terminalJob.status}.`,
          metadata: terminalMetadata,
        });
        this.#diagnosticsLogger.warn("Command job failed.", terminalMetadata);
      }
    } catch (error) {
      const terminalJob = this.#saveUnexpectedFailure(runningJob, error);
      const metadata = commandJobAuditMetadata(terminalJob);
      await this.#recordAudit({
        operation,
        eventType: "operation_failed",
        decision: { outcome: "allowed", message: "Command job execution failed." },
        message: "Command job execution failed unexpectedly.",
        metadata: {
          ...metadata,
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
      this.#diagnosticsLogger.error("Command job failed unexpectedly.", {
        ...metadata,
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (this.#jobStore.list({ workspaceId: runningJob.workspaceId, status: ["running"] }).length === 0) {
        this.#workspaceLifecycleService?.markIdle(runningJob.workspaceId);
      }
    }
  }

  #handleQueueFailure(jobId: string, error: unknown): void {
    const job = this.#jobStore.get(jobId);
    if (job === null || isTerminalStatus(job.status)) {
      return;
    }

    const failedJob = this.#saveJob({
      ...job,
      status: "failed",
      finishedAt: this.#clock().toISOString(),
      updatedAt: this.#clock().toISOString(),
      elapsedMs: elapsedMs(job.startedAt ?? job.createdAt, this.#clock()),
      failureKind: "queue",
      stderr: error instanceof Error ? error.message : String(error),
      stderrBytes: Buffer.byteLength(error instanceof Error ? error.message : String(error), "utf8"),
    });

    this.#diagnosticsLogger.error("Command job queue failed.", {
      ...commandJobAuditMetadata(failedJob),
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    this.#workspaceLifecycleService?.markIdle(failedJob.workspaceId);
  }

  #saveTerminalJob(runningJob: CommandJob, result: ProcessRunnerResult): CommandJob {
    const finishedAt = this.#clock();
    return this.#saveJob({
      ...runningJob,
      status: statusFromProcessResult(result),
      updatedAt: finishedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      elapsedMs: elapsedMs(runningJob.startedAt ?? runningJob.createdAt, finishedAt),
      exitCode: result.exitCode,
      signal: result.signal,
      failureKind: normalizeFailureKind(result.failureKind),
      stdout: result.stdout,
      stderr: result.stderr,
      stdoutBytes: result.stdoutBytes,
      stderrBytes: result.stderrBytes,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated,
    });
  }

  #saveUnexpectedFailure(runningJob: CommandJob, error: unknown): CommandJob {
    const finishedAt = this.#clock();
    const message = error instanceof Error ? error.message : String(error);
    return this.#saveJob({
      ...runningJob,
      status: "failed",
      updatedAt: finishedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      elapsedMs: elapsedMs(runningJob.startedAt ?? runningJob.createdAt, finishedAt),
      failureKind: "unknown",
      stderr: message,
      stderrBytes: Buffer.byteLength(message, "utf8"),
    });
  }

  #saveJob(job: CommandJob): CommandJob {
    return this.#jobStore.save(commandJobSchema.parse(job));
  }

  #resolveCwd(workspaceId: string, rawCwd: string | undefined): {
    absolutePath: string;
    displayPath: string;
    relativePath: string | null;
  } {
    const root = this.#workspaceFilesystem.resolveWorkspaceDirectoryForOperation(workspaceId);
    if (rawCwd === undefined || rawCwd === ".") {
      return { absolutePath: root, displayPath: ".", relativePath: null };
    }

    try {
      this.#workspaceFilesystem.assertWorkspaceRelativePathInsideBoundary(workspaceId, rawCwd);
      return {
        absolutePath: resolve(root, rawCwd),
        displayPath: rawCwd.replaceAll("\\", "/"),
        relativePath: rawCwd,
      };
    } catch (error) {
      if (error instanceof WorkspacePathBoundaryError) {
        throw new CommandJobServiceError(
          COMMAND_JOB_ERROR_CODES.invalidCwd,
          "Command cwd must stay inside the workspace.",
          { workspaceId, cwd: rawCwd, reasonCode: error.code, message: error.message },
        );
      }

      throw error;
    }
  }

  #requireReadyWorkspace(workspaceId: string): Workspace {
    const workspace = this.#requireExistingWorkspace(workspaceId);

    if (workspace.status !== "ready") {
      throw new CommandJobServiceError(
        COMMAND_JOB_ERROR_CODES.workspaceUnavailable,
        "Workspace is not ready for command execution.",
        { workspaceId, status: workspace.status },
      );
    }

    return workspace;
  }

  #requireExistingWorkspace(workspaceId: string): Workspace {
    const workspace = this.#workspaceRegistry.getWorkspace(workspaceId);
    if (workspace === null) {
      throw new CommandJobServiceError(
        COMMAND_JOB_ERROR_CODES.workspaceNotFound,
        "Workspace not found.",
        { workspaceId },
      );
    }

    return workspace;
  }

  async #recordAudit(input: Parameters<typeof createAuditEvent>[0]): Promise<void> {
    await this.#security.auditRecorder.record(createAuditEvent(input, {
      now: this.#clock(),
      logMasker: this.#security.logMasker,
    }));
  }
}

export function createCommandJobId(): string {
  return `job_${randomUUID()}`;
}

export function toCommandJobToolFailure(error: unknown): ToolFailure {
  const serviceError = toCommandJobServiceError(error);
  return toolError(serviceError.code, serviceError.message, serviceError.details);
}

function toCommandJobServiceError(
  error: unknown,
  workspaceId?: string,
): CommandJobServiceError {
  if (error instanceof CommandJobServiceError) {
    return error;
  }

  if (error instanceof RunnerOperationDeniedError) {
    return new CommandJobServiceError(
      COMMAND_JOB_ERROR_CODES.operationDenied,
      error.decision.message ?? "Command operation denied by policy.",
      {
        workspaceId: error.operation.workspaceId,
        reasonCode: error.decision.reasonCode,
        action: error.operation.action,
      },
    );
  }

  return new CommandJobServiceError(
    COMMAND_JOB_ERROR_CODES.commandStatusFailed,
    "Command job operation failed.",
    {
      ...(workspaceId === undefined ? {} : { workspaceId }),
      message: error instanceof Error ? error.message : String(error),
    },
  );
}

function validateTimeout(timeoutMs: number, policyTimeoutMs: number): number {
  if (timeoutMs > policyTimeoutMs) {
    throw new CommandJobServiceError(
      COMMAND_JOB_ERROR_CODES.timeoutExceedsPolicy,
      "Command timeout exceeds the workspace command policy limit.",
      { timeoutMs, policyTimeoutMs },
    );
  }

  return Math.min(timeoutMs, COMMAND_JOB_HARD_LIMITS.timeoutMs);
}

function statusFromProcessResult(result: ProcessRunnerResult): CommandJob["status"] {
  if (result.cancelled) {
    return "cancelled";
  }

  if (result.timedOut || result.failureKind === "timeout") {
    return "timed_out";
  }

  if (result.failed) {
    return "failed";
  }

  return "succeeded";
}

function normalizeFailureKind(kind: ProcessFailureKind | null): CommandFailureKind | null {
  if (kind === null) {
    return null;
  }

  return kind;
}

function elapsedMs(startedAt: string, finishedAt: Date): number {
  return Math.max(0, finishedAt.getTime() - Date.parse(startedAt));
}

function isTerminalStatus(status: CommandJob["status"]): boolean {
  return status === "succeeded"
    || status === "failed"
    || status === "timed_out"
    || status === "cancelled";
}

function commandJobAuditMetadata(job: CommandJob): Record<string, unknown> {
  return {
    jobId: job.jobId,
    workspaceId: job.workspaceId,
    status: job.status,
    cwd: job.cwd,
    exitCode: job.exitCode,
    signal: job.signal,
    failureKind: job.failureKind,
    elapsedMs: job.elapsedMs,
    stdoutBytes: job.stdoutBytes,
    stderrBytes: job.stderrBytes,
    stdoutTruncated: job.stdoutTruncated,
    stderrTruncated: job.stderrTruncated,
  };
}
