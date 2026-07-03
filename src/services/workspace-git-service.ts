import {
  toolError,
  type ToolFailure,
  type Workspace,
  type WorkspaceDiffData,
  type WorkspaceGitStatusData,
} from "../domain/index.ts";
import {
  GIT_ADAPTER_ERROR_CODES,
  GitAdapterError,
  LocalGitAdapter,
  type GitAdapter,
} from "../adapters/git/index.ts";
import { runAuditedOperation, RunnerOperationDeniedError } from "../security/audit.ts";
import { evaluateWorkspaceOperationPolicy, type SecurityActor } from "../security/policy.ts";
import type { RunnerSecurityServices } from "../security/services.ts";
import { LocalWorkspaceFilesystem } from "./local-workspace-filesystem.ts";
import { type Clock, type WorkspaceRegistry } from "./workspace-registry.ts";

export const WORKSPACE_GIT_DEFAULT_LIMITS = {
  maxFiles: 500,
  maxPatchBytes: 200_000,
} as const;

export const WORKSPACE_GIT_HARD_LIMITS = {
  maxFiles: 5_000,
  maxPatchBytes: 2_000_000,
} as const;

export const WORKSPACE_GIT_ERROR_CODES = {
  invalidInput: "invalid_input",
  workspaceNotFound: "workspace_not_found",
  workspaceUnavailable: "workspace_unavailable",
  operationDenied: "operation_denied",
  gitUnavailable: "git_unavailable",
  notGitWorkspace: "not_git_workspace",
  gitStatusFailed: "git_status_failed",
  gitDiffFailed: "git_diff_failed",
} as const;

export type WorkspaceGitErrorCode =
  (typeof WORKSPACE_GIT_ERROR_CODES)[keyof typeof WORKSPACE_GIT_ERROR_CODES];

export class WorkspaceGitServiceError extends Error {
  readonly code: WorkspaceGitErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: WorkspaceGitErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "WorkspaceGitServiceError";
    this.code = code;
    this.details = details;
  }
}

export type WorkspaceGitServiceOptions = {
  workspaceRegistry: WorkspaceRegistry;
  workspaceFilesystem: LocalWorkspaceFilesystem;
  security: RunnerSecurityServices;
  gitAdapter?: GitAdapter;
  clock?: Clock;
};

export type GetGitStatusRequest = {
  workspaceId: string;
  maxFiles?: number;
  actor?: SecurityActor;
};

export type GetWorkspaceDiffRequest = {
  workspaceId: string;
  includePatch?: boolean;
  maxFiles?: number;
  maxPatchBytes?: number;
  actor?: SecurityActor;
};

export class WorkspaceGitService {
  readonly #workspaceRegistry: WorkspaceRegistry;
  readonly #workspaceFilesystem: LocalWorkspaceFilesystem;
  readonly #security: RunnerSecurityServices;
  readonly #gitAdapter: GitAdapter;
  readonly #clock: Clock;

  constructor({
    workspaceRegistry,
    workspaceFilesystem,
    security,
    gitAdapter = new LocalGitAdapter(),
    clock = () => new Date(),
  }: WorkspaceGitServiceOptions) {
    this.#workspaceRegistry = workspaceRegistry;
    this.#workspaceFilesystem = workspaceFilesystem;
    this.#security = security;
    this.#gitAdapter = gitAdapter;
    this.#clock = clock;
  }

  async getGitStatus(input: GetGitStatusRequest): Promise<WorkspaceGitStatusData> {
    const workspace = this.#requireReadyWorkspace(input.workspaceId);
    const maxFiles = clampLimit(
      input.maxFiles ?? WORKSPACE_GIT_DEFAULT_LIMITS.maxFiles,
      1,
      WORKSPACE_GIT_HARD_LIMITS.maxFiles,
    );

    const snapshot = await this.#runGitOperation({
      workspace,
      action: "get_git_status",
      actor: input.actor ?? "assistant",
      metadata: { maxFiles },
      execute: () => this.#gitAdapter.getStatus(
        this.#workspaceFilesystem.resolveWorkspaceDirectoryForOperation(workspace.workspaceId),
      ),
    });

    const changedFiles = snapshot.changedFiles.slice(0, maxFiles);

    return {
      workspaceId: workspace.workspaceId,
      clean: snapshot.changedFiles.length === 0,
      branch: snapshot.branch,
      headCommit: snapshot.headCommit,
      changedFiles,
      truncated: changedFiles.length < snapshot.changedFiles.length,
      totalChangedFiles: snapshot.changedFiles.length,
      limits: { maxFiles },
    };
  }

  async getWorkspaceDiff(input: GetWorkspaceDiffRequest): Promise<WorkspaceDiffData> {
    const workspace = this.#requireReadyWorkspace(input.workspaceId);
    const policy = this.#security.createWorkspacePolicy(workspace);
    const maxFiles = clampLimit(
      input.maxFiles ?? WORKSPACE_GIT_DEFAULT_LIMITS.maxFiles,
      1,
      WORKSPACE_GIT_HARD_LIMITS.maxFiles,
    );
    const maxPatchBytes = clampLimit(
      input.maxPatchBytes ?? WORKSPACE_GIT_DEFAULT_LIMITS.maxPatchBytes,
      1,
      Math.min(policy.git.maxPatchBytes, WORKSPACE_GIT_HARD_LIMITS.maxPatchBytes),
    );
    const includePatch = input.includePatch ?? true;

    const snapshot = await this.#runGitOperation({
      workspace,
      action: "get_workspace_diff",
      actor: input.actor ?? "assistant",
      metadata: { maxFiles, maxPatchBytes, includePatch },
      execute: () => this.#gitAdapter.getDiff(
        this.#workspaceFilesystem.resolveWorkspaceDirectoryForOperation(workspace.workspaceId),
        { includePatch, maxPatchBytes },
      ),
    });
    const changedFiles = snapshot.changedFiles.slice(0, maxFiles);

    return {
      workspaceId: workspace.workspaceId,
      clean: snapshot.changedFiles.length === 0,
      branch: snapshot.branch,
      headCommit: snapshot.headCommit,
      changedFiles,
      changedFilesTruncated: changedFiles.length < snapshot.changedFiles.length,
      totalChangedFiles: snapshot.changedFiles.length,
      diffstat: snapshot.diffstat,
      patch: snapshot.patch,
      limits: {
        maxFiles,
        maxPatchBytes,
      },
    };
  }

  #requireReadyWorkspace(workspaceId: string): Workspace {
    const workspace = this.#workspaceRegistry.getWorkspace(workspaceId);
    if (workspace === null) {
      throw new WorkspaceGitServiceError(
        WORKSPACE_GIT_ERROR_CODES.workspaceNotFound,
        "Workspace not found.",
        { workspaceId },
      );
    }

    if (workspace.status !== "ready") {
      throw new WorkspaceGitServiceError(
        WORKSPACE_GIT_ERROR_CODES.workspaceUnavailable,
        "Workspace is not ready for git inspection.",
        { workspaceId, status: workspace.status },
      );
    }

    return workspace;
  }

  async #runGitOperation<Result>({
    workspace,
    action,
    actor,
    metadata,
    execute,
  }: {
    workspace: Workspace;
    action: "get_git_status" | "get_workspace_diff";
    actor: SecurityActor;
    metadata: Record<string, unknown>;
    execute: () => Promise<Result>;
  }): Promise<Result> {
    const policy = this.#security.createWorkspacePolicy(workspace);
    const operation = {
      workspaceId: workspace.workspaceId,
      operationKind: "git",
      action,
      actor,
      metadata,
    } as const;

    try {
      return await runAuditedOperation({
        recorder: this.#security.auditRecorder,
        operation,
        evaluatePolicy: () => evaluateWorkspaceOperationPolicy(policy, operation),
        execute,
        now: this.#clock,
        logMasker: this.#security.logMasker,
      });
    } catch (error) {
      throw toWorkspaceGitServiceError(error, workspace.workspaceId, action);
    }
  }
}

export function toWorkspaceGitToolFailure(error: unknown): ToolFailure {
  if (error instanceof WorkspaceGitServiceError) {
    return toolError(error.code, error.message, error.details);
  }

  return toolError(
    WORKSPACE_GIT_ERROR_CODES.gitDiffFailed,
    "Workspace git operation failed.",
    { message: error instanceof Error ? error.message : String(error) },
  );
}

function toWorkspaceGitServiceError(
  error: unknown,
  workspaceId: string,
  action: "get_git_status" | "get_workspace_diff",
): WorkspaceGitServiceError {
  if (error instanceof WorkspaceGitServiceError) {
    return error;
  }

  if (error instanceof RunnerOperationDeniedError) {
    return new WorkspaceGitServiceError(
      WORKSPACE_GIT_ERROR_CODES.operationDenied,
      error.decision.message ?? "Workspace git operation denied by policy.",
      {
        workspaceId,
        reasonCode: error.decision.reasonCode,
        action: error.operation.action,
      },
    );
  }

  if (error instanceof GitAdapterError) {
    switch (error.code) {
      case GIT_ADAPTER_ERROR_CODES.gitUnavailable:
        return new WorkspaceGitServiceError(
          WORKSPACE_GIT_ERROR_CODES.gitUnavailable,
          "Git executable is unavailable.",
          { workspaceId },
        );
      case GIT_ADAPTER_ERROR_CODES.notGitWorkspace:
        return new WorkspaceGitServiceError(
          WORKSPACE_GIT_ERROR_CODES.notGitWorkspace,
          "Workspace directory is not a git work tree.",
          { workspaceId },
        );
      case GIT_ADAPTER_ERROR_CODES.gitCommandFailed:
        return new WorkspaceGitServiceError(
          action === "get_git_status"
            ? WORKSPACE_GIT_ERROR_CODES.gitStatusFailed
            : WORKSPACE_GIT_ERROR_CODES.gitDiffFailed,
          action === "get_git_status"
            ? "Git status inspection failed."
            : "Workspace diff inspection failed.",
          {
            workspaceId,
            ...error.toSafeDetails(),
          },
        );
    }
  }

  return new WorkspaceGitServiceError(
    action === "get_git_status"
      ? WORKSPACE_GIT_ERROR_CODES.gitStatusFailed
      : WORKSPACE_GIT_ERROR_CODES.gitDiffFailed,
    "Workspace git operation failed.",
    { workspaceId, message: error instanceof Error ? error.message : String(error) },
  );
}

function clampLimit(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
