import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InMemoryAuditEventRecorder,
  createRunnerSecurityServices,
  createWorkspaceSecurityPolicy,
} from "../src/security/index.ts";
import { NoopDiagnosticsLogger } from "../src/adapters/logging/index.ts";
import type { ProcessRunner, ProcessRunnerRequest, ProcessRunnerResult } from "../src/adapters/process/index.ts";
import { PQueueJobQueue, type JobQueue, type JobQueueRunOptions, type JobQueueStats } from "../src/adapters/queue/index.ts";
import { CommandJobService } from "../src/services/command-job-service.ts";
import { LocalWorkspaceFilesystem } from "../src/services/local-workspace-filesystem.ts";
import { WorkspaceLifecycleService } from "../src/services/workspace-lifecycle-service.ts";
import { WorkspaceRegistry } from "../src/services/workspace-registry.ts";
import { InMemoryCommandJobStore } from "../src/storage/in-memory-command-job-store.ts";
import { InMemoryWorkspaceLifecycleStore } from "../src/storage/in-memory-workspace-lifecycle-store.ts";
import { InMemoryWorkspaceStore } from "../src/storage/in-memory-workspace-store.ts";

function createFixture({
  processRunner = new StaticProcessRunner(successResult()),
  jobQueue = new PQueueJobQueue({ concurrency: 2, perWorkspaceConcurrency: 1 }),
  createJobId = sequenceId("job_service"),
}: {
  processRunner?: ProcessRunner;
  jobQueue?: JobQueue;
  createJobId?: () => string;
} = {}) {
  const parent = mkdtempSync(join(tmpdir(), "asagao-command-service-"));
  const filesystem = new LocalWorkspaceFilesystem({ workspaceRoot: join(parent, "workspaces") });
  const auditRecorder = new InMemoryAuditEventRecorder();
  const security = createRunnerSecurityServices({
    auditRecorder,
    createWorkspacePolicy: (workspace) => createWorkspaceSecurityPolicy(workspace, {
      command: {
        mode: "allowlist",
        allowlist: [{ executable: process.execPath }],
        timeoutMs: 1_000,
        maxOutputBytes: 1_024,
      },
    }),
  });
  const registry = new WorkspaceRegistry({
    store: new InMemoryWorkspaceStore(),
    filesystem,
    createId: sequenceId("wks_service"),
  });
  const lifecycleStore = new InMemoryWorkspaceLifecycleStore();
  const lifecycleService = new WorkspaceLifecycleService({
    workspaceRegistry: registry,
    lifecycleStore,
    security,
  });
  const jobStore = new InMemoryCommandJobStore();
  const service = new CommandJobService({
    workspaceRegistry: registry,
    workspaceFilesystem: filesystem,
    security,
    processRunner,
    jobQueue,
    jobStore,
    workspaceLifecycleService: lifecycleService,
    diagnosticsLogger: new NoopDiagnosticsLogger(),
    createJobId,
  });

  return {
    parent,
    auditRecorder,
    filesystem,
    registry,
    lifecycleService,
    jobStore,
    service,
    cleanup: () => rmSync(parent, { recursive: true, force: true }),
  };
}

test("CommandJobService queues commands immediately and stores successful results", async () => {
  const fixture = createFixture({
    processRunner: new StaticProcessRunner(successResult({ stdout: "ok\n", stdoutBytes: 3 })),
    createJobId: () => "job_service001",
  });
  try {
    const workspace = fixture.registry.createWorkspace({});

    const queued = await fixture.service.runCommand({
      workspaceId: workspace.workspaceId,
      command: [process.execPath, "--version"],
      timeoutMs: 500,
    });

    assert.equal(queued.jobId, "job_service001");
    assert.equal(queued.status, "queued");
    const completed = await waitForJob(fixture.service, workspace.workspaceId, queued.jobId, "succeeded");
    assert.equal(completed.exitCode, 0);
    assert.equal(completed.stdout, "ok\n");
    assert.equal(completed.elapsedMs !== null, true);
    assert.equal(fixture.lifecycleService.getWorkspaceLifecycle(workspace.workspaceId)?.lifecycle.busy, false);
    assert.deepEqual(
      fixture.auditRecorder.listEvents()
        .filter((event) => event.action === "run_command")
        .map((event) => event.eventType),
      ["policy_evaluated", "operation_started", "operation_succeeded"],
    );
  } finally {
    fixture.cleanup();
  }
});

test("CommandJobService denies shell executables even when commands are arrays", async () => {
  const fixture = createFixture();
  try {
    const workspace = fixture.registry.createWorkspace({});

    await assert.rejects(
      () => fixture.service.runCommand({
        workspaceId: workspace.workspaceId,
        command: ["bash", "-lc", "echo unsafe"],
        timeoutMs: 500,
      }),
      /shell execution is not allowed/,
    );
    assert.equal(fixture.jobStore.list().length, 0);
    assert.deepEqual(
      fixture.auditRecorder.listEvents().map((event) => event.eventType),
      ["policy_evaluated", "operation_denied"],
    );
  } finally {
    fixture.cleanup();
  }
});

test("CommandJobService rejects cwd outside the workspace", async () => {
  const fixture = createFixture();
  try {
    const workspace = fixture.registry.createWorkspace({});

    await assert.rejects(
      () => fixture.service.runCommand({
        workspaceId: workspace.workspaceId,
        command: [process.execPath, "--version"],
        cwd: "../outside",
        timeoutMs: 500,
      }),
      /cwd must stay inside the workspace/,
    );
    assert.equal(fixture.jobStore.list().length, 0);
  } finally {
    fixture.cleanup();
  }
});

test("CommandJobService stores timed out terminal jobs", async () => {
  const fixture = createFixture({
    processRunner: new StaticProcessRunner(successResult({
      failed: true,
      failureKind: "timeout",
      timedOut: true,
      exitCode: null,
    })),
    createJobId: () => "job_service001",
  });
  try {
    const workspace = fixture.registry.createWorkspace({});

    const queued = await fixture.service.runCommand({
      workspaceId: workspace.workspaceId,
      command: [process.execPath, "-e", "setTimeout(() => {}, 1000)"],
      timeoutMs: 20,
    });

    const completed = await waitForJob(fixture.service, workspace.workspaceId, queued.jobId, "timed_out");
    assert.equal(completed.failureKind, "timeout");
    assert.equal(completed.exitCode, null);
    assert.equal(completed.finishedAt !== null, true);
  } finally {
    fixture.cleanup();
  }
});

test("CommandJobService serializes commands for the same workspace", async () => {
  const deferredRunner = new DeferredProcessRunner();
  const fixture = createFixture({
    processRunner: deferredRunner,
    createJobId: sequenceId("job_service"),
  });
  try {
    const workspace = fixture.registry.createWorkspace({});

    const first = await fixture.service.runCommand({
      workspaceId: workspace.workspaceId,
      command: [process.execPath, "-e", "1"],
      timeoutMs: 500,
    });
    const second = await fixture.service.runCommand({
      workspaceId: workspace.workspaceId,
      command: [process.execPath, "-e", "2"],
      timeoutMs: 500,
    });

    await deferredRunner.waitForRunCount(1);
    assert.equal(fixture.jobStore.get(first.jobId)?.status, "running");
    assert.equal(fixture.jobStore.get(second.jobId)?.status, "queued");

    deferredRunner.completeNext(successResult());
    await waitForJob(fixture.service, workspace.workspaceId, first.jobId, "succeeded");
    await deferredRunner.waitForRunCount(2);
    assert.equal(fixture.jobStore.get(second.jobId)?.status, "running");

    deferredRunner.completeNext(successResult());
    await waitForJob(fixture.service, workspace.workspaceId, second.jobId, "succeeded");
  } finally {
    fixture.cleanup();
  }
});


test("CommandJobService keeps lifecycle busy while queued jobs remain", async () => {
  const manualQueue = new ManualJobQueue();
  const fixture = createFixture({
    jobQueue: manualQueue,
    processRunner: new StaticProcessRunner(successResult()),
    createJobId: sequenceId("job_service"),
  });
  try {
    const workspace = fixture.registry.createWorkspace({});

    const first = await fixture.service.runCommand({
      workspaceId: workspace.workspaceId,
      command: [process.execPath, "-e", "1"],
      timeoutMs: 500,
    });
    const second = await fixture.service.runCommand({
      workspaceId: workspace.workspaceId,
      command: [process.execPath, "-e", "2"],
      timeoutMs: 500,
    });

    assert.equal(fixture.jobStore.get(first.jobId)?.status, "queued");
    assert.equal(fixture.jobStore.get(second.jobId)?.status, "queued");
    assert.equal(fixture.lifecycleService.getWorkspaceLifecycle(workspace.workspaceId)?.lifecycle.busy, true);

    await manualQueue.runNext();
    await waitForJob(fixture.service, workspace.workspaceId, first.jobId, "succeeded");
    assert.equal(fixture.jobStore.get(second.jobId)?.status, "queued");
    assert.equal(fixture.lifecycleService.getWorkspaceLifecycle(workspace.workspaceId)?.lifecycle.busy, true);

    await manualQueue.runNext();
    await waitForJob(fixture.service, workspace.workspaceId, second.jobId, "succeeded");
    assert.equal(fixture.lifecycleService.getWorkspaceLifecycle(workspace.workspaceId)?.lifecycle.busy, false);
  } finally {
    fixture.cleanup();
  }
});


test("CommandJobService audits queue failures", async () => {
  const fixture = createFixture({
    jobQueue: new RejectingJobQueue(new Error("queue offline")),
    createJobId: () => "job_service001",
  });
  try {
    const workspace = fixture.registry.createWorkspace({});

    const queued = await fixture.service.runCommand({
      workspaceId: workspace.workspaceId,
      command: [process.execPath, "--version"],
      timeoutMs: 500,
    });
    const failed = await waitForJob(fixture.service, workspace.workspaceId, queued.jobId, "failed");

    assert.equal(failed.failureKind, "queue");
    assert.match(failed.stderr, /queue offline/);
    assert.equal(fixture.lifecycleService.getWorkspaceLifecycle(workspace.workspaceId)?.lifecycle.busy, false);
    assert.equal(
      fixture.auditRecorder.listEvents().some(
        (event) => event.action === "run_command" && event.eventType === "operation_failed",
      ),
      true,
    );
  } finally {
    fixture.cleanup();
  }
});

test("CommandJobService resolves workspace-relative cwd for process execution", async () => {
  const captureRunner = new CaptureProcessRunner(successResult());
  const fixture = createFixture({ processRunner: captureRunner, createJobId: () => "job_service001" });
  try {
    const workspace = fixture.registry.createWorkspace({});
    mkdirSync(join(fixture.filesystem.resolveWorkspaceDirectoryForOperation(workspace.workspaceId), "src"));

    const queued = await fixture.service.runCommand({
      workspaceId: workspace.workspaceId,
      command: [process.execPath, "--version"],
      cwd: "src",
      timeoutMs: 500,
    });

    await waitForJob(fixture.service, workspace.workspaceId, queued.jobId, "succeeded");
    assert.equal(captureRunner.requests[0]?.cwd, join(fixture.filesystem.resolveWorkspaceDirectoryForOperation(workspace.workspaceId), "src"));
  } finally {
    fixture.cleanup();
  }
});

class ManualJobQueue implements JobQueue {
  readonly #jobs: Array<{
    job: () => Promise<unknown>;
    resolve: (result: unknown) => void;
    reject: (error: unknown) => void;
  }> = [];

  add<Result>(job: () => Promise<Result>, _options: JobQueueRunOptions = {}): Promise<Result> {
    return new Promise<Result>((resolve, reject) => {
      this.#jobs.push({
        job,
        resolve: resolve as (result: unknown) => void,
        reject,
      });
    });
  }

  async runNext(): Promise<void> {
    const next = this.#jobs.shift();
    if (next === undefined) {
      throw new Error("No queued job to run.");
    }

    try {
      next.resolve(await next.job());
    } catch (error) {
      next.reject(error);
    }
  }

  stats(): JobQueueStats {
    return {
      pending: this.#jobs.length,
      running: 0,
      size: this.#jobs.length,
    };
  }
}

class RejectingJobQueue implements JobQueue {
  readonly #error: Error;

  constructor(error: Error) {
    this.#error = error;
  }

  async add<Result>(_job: () => Promise<Result>, _options: JobQueueRunOptions = {}): Promise<Result> {
    throw this.#error;
  }

  stats(): JobQueueStats {
    return { pending: 0, running: 0, size: 0 };
  }
}

class StaticProcessRunner implements ProcessRunner {
  readonly result: ProcessRunnerResult;

  constructor(result: ProcessRunnerResult) {
    this.result = result;
  }

  async run(): Promise<ProcessRunnerResult> {
    return this.result;
  }
}

class CaptureProcessRunner implements ProcessRunner {
  readonly requests: ProcessRunnerRequest[] = [];
  readonly result: ProcessRunnerResult;

  constructor(result: ProcessRunnerResult) {
    this.result = result;
  }

  async run(request: ProcessRunnerRequest): Promise<ProcessRunnerResult> {
    this.requests.push(request);
    return this.result;
  }
}

class DeferredProcessRunner implements ProcessRunner {
  readonly #runs: Array<{
    request: ProcessRunnerRequest;
    resolve: (result: ProcessRunnerResult) => void;
  }> = [];
  readonly #waiters: Array<() => void> = [];
  #totalRuns = 0;

  async run(request: ProcessRunnerRequest): Promise<ProcessRunnerResult> {
    return new Promise((resolve) => {
      this.#totalRuns += 1;
      this.#runs.push({ request, resolve });
      this.#flushWaiters();
    });
  }

  async waitForRunCount(count: number): Promise<void> {
    while (this.#totalRuns < count) {
      await new Promise<void>((resolve) => this.#waiters.push(resolve));
    }
  }

  completeNext(result: ProcessRunnerResult): void {
    const next = this.#runs.shift();
    if (next === undefined) {
      throw new Error("No pending process run to complete.");
    }
    next.resolve(result);
  }

  #flushWaiters(): void {
    while (this.#waiters.length > 0) {
      this.#waiters.shift()?.();
    }
  }
}

async function waitForJob(
  service: CommandJobService,
  workspaceId: string,
  jobId: string,
  status: "succeeded" | "failed" | "timed_out" | "cancelled",
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = await service.getCommandStatus({ workspaceId, jobId });
    if (job.status === status) {
      return job;
    }
    await delay(5);
  }

  throw new Error(`Timed out waiting for ${jobId} to reach ${status}.`);
}

function successResult(overrides: Partial<ProcessRunnerResult> = {}): ProcessRunnerResult {
  return {
    command: [process.execPath],
    cwd: null,
    failed: false,
    failureKind: null,
    exitCode: 0,
    signal: null,
    timedOut: false,
    cancelled: false,
    stdout: "",
    stderr: "",
    stdoutBytes: 0,
    stderrBytes: 0,
    stdoutTruncated: false,
    stderrTruncated: false,
    ...overrides,
  };
}

function sequenceId(prefix: string): () => string {
  let next = 1;
  return () => `${prefix}${String(next++).padStart(3, "0")}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
