import {
  workspaceLifecycleDecisionSchema,
  workspaceLifecycleSnapshotSchema,
  type Workspace,
  type WorkspaceBusyState,
  type WorkspaceDirtyState,
  type WorkspaceLifecycleBlocker,
  type WorkspaceLifecycleDecision,
  type WorkspaceLifecycleOperation,
  type WorkspaceLifecycleMetadata,
  type WorkspaceLifecycleSnapshot,
} from "../domain/index.ts";
import {
  allowDecision,
  createAuditEvent,
  denyDecision,
  evaluateWorkspaceOperationPolicy,
  type PolicyDecision,
  type RunnerSecurityServices,
  type SecurityActor,
} from "../security/index.ts";
import {
  markWorkspaceCleanBoundaryObserved,
  markWorkspaceClaimed,
  markWorkspaceResetBoundaryObserved,
  updateWorkspaceBusyState,
  updateWorkspaceDirtyState,
  type WorkspaceLifecycleStore,
} from "../storage/in-memory-workspace-lifecycle-store.ts";
import type { Clock, WorkspaceRegistry } from "./workspace-registry.ts";

export type WorkspaceLifecycleServiceOptions = {
  workspaceRegistry: WorkspaceRegistry;
  lifecycleStore: WorkspaceLifecycleStore;
  security: RunnerSecurityServices;
  clock?: Clock;
};

export type WorkspaceLifecycleRecord = {
  workspace: Workspace;
  lifecycle: WorkspaceLifecycleSnapshot;
};

export type WorkspaceLifecycleMutationInput = {
  workspaceId: string;
  actor?: SecurityActor;
};

export class WorkspaceLifecycleService {
  readonly #workspaceRegistry: WorkspaceRegistry;
  readonly #lifecycleStore: WorkspaceLifecycleStore;
  readonly #security: RunnerSecurityServices;
  readonly #clock: Clock;

  constructor({
    workspaceRegistry,
    lifecycleStore,
    security,
    clock = () => new Date(),
  }: WorkspaceLifecycleServiceOptions) {
    this.#workspaceRegistry = workspaceRegistry;
    this.#lifecycleStore = lifecycleStore;
    this.#security = security;
    this.#clock = clock;
  }

  getWorkspaceLifecycle(workspaceId: string): WorkspaceLifecycleRecord | null {
    const workspace = this.#workspaceRegistry.getWorkspace(workspaceId);
    if (workspace === null) {
      return null;
    }

    return {
      workspace,
      lifecycle: this.evaluateWorkspace(workspace),
    };
  }

  evaluateWorkspace(workspace: Workspace): WorkspaceLifecycleSnapshot {
    const now = this.#clock();
    const metadata = this.#lifecycleStore.getOrCreate(workspace.workspaceId, now);
    return evaluateWorkspaceLifecycle({ workspace, metadata, now });
  }

  markDirty(workspaceId: string): WorkspaceLifecycleSnapshot | null {
    return this.#markDirtyState(workspaceId, "dirty");
  }

  markClean(workspaceId: string): WorkspaceLifecycleSnapshot | null {
    return this.#markDirtyState(workspaceId, "clean");
  }

  markDirtyUnknown(workspaceId: string): WorkspaceLifecycleSnapshot | null {
    return this.#markDirtyState(workspaceId, "unknown");
  }

  markBusy(workspaceId: string): WorkspaceLifecycleSnapshot | null {
    return this.#markBusyState(workspaceId, "busy");
  }

  markIdle(workspaceId: string): WorkspaceLifecycleSnapshot | null {
    return this.#markBusyState(workspaceId, "idle");
  }

  async claimWorkspace(
    input: WorkspaceLifecycleMutationInput,
  ): Promise<WorkspaceLifecycleDecision | null> {
    return this.#runLifecycleOperation({
      workspaceId: input.workspaceId,
      operation: "claim_workspace",
      actor: input.actor ?? "assistant",
      isImplemented: true,
      commit: (workspace, now) => {
        const metadata = this.#lifecycleStore.getOrCreate(workspace.workspaceId, now);
        this.#lifecycleStore.save(markWorkspaceClaimed(metadata, now));
      },
    });
  }

  async resetWorkspace(
    input: WorkspaceLifecycleMutationInput,
  ): Promise<WorkspaceLifecycleDecision | null> {
    return this.#runLifecycleOperation({
      workspaceId: input.workspaceId,
      operation: "reset_workspace",
      actor: input.actor ?? "assistant",
      isImplemented: false,
      commit: (workspace, now) => {
        const metadata = this.#lifecycleStore.getOrCreate(workspace.workspaceId, now);
        this.#lifecycleStore.save(markWorkspaceResetBoundaryObserved(metadata, now));
      },
    });
  }

  async cleanWorkspace(
    input: WorkspaceLifecycleMutationInput,
  ): Promise<WorkspaceLifecycleDecision | null> {
    return this.#runLifecycleOperation({
      workspaceId: input.workspaceId,
      operation: "clean_workspace",
      actor: input.actor ?? "assistant",
      isImplemented: false,
      commit: (workspace, now) => {
        const metadata = this.#lifecycleStore.getOrCreate(workspace.workspaceId, now);
        this.#lifecycleStore.save(markWorkspaceCleanBoundaryObserved(metadata, now));
      },
    });
  }

  #markDirtyState(
    workspaceId: string,
    dirtyState: WorkspaceDirtyState,
  ): WorkspaceLifecycleSnapshot | null {
    const workspace = this.#workspaceRegistry.getWorkspace(workspaceId);
    if (workspace === null) {
      return null;
    }

    const now = this.#clock();
    const metadata = this.#lifecycleStore.getOrCreate(workspaceId, now);
    this.#lifecycleStore.save(updateWorkspaceDirtyState(metadata, dirtyState, now));
    return this.evaluateWorkspace(workspace);
  }

  #markBusyState(
    workspaceId: string,
    busyState: WorkspaceBusyState,
  ): WorkspaceLifecycleSnapshot | null {
    const workspace = this.#workspaceRegistry.getWorkspace(workspaceId);
    if (workspace === null) {
      return null;
    }

    const now = this.#clock();
    const metadata = this.#lifecycleStore.getOrCreate(workspaceId, now);
    this.#lifecycleStore.save(updateWorkspaceBusyState(metadata, busyState, now));
    return this.evaluateWorkspace(workspace);
  }

  async #runLifecycleOperation({
    workspaceId,
    operation,
    actor,
    isImplemented,
    commit,
  }: {
    workspaceId: string;
    operation: Exclude<WorkspaceLifecycleOperation, "get_workspace_lifecycle">;
    actor: SecurityActor;
    isImplemented: boolean;
    commit: (workspace: Workspace, now: Date) => void;
  }): Promise<WorkspaceLifecycleDecision | null> {
    const workspace = this.#workspaceRegistry.getWorkspace(workspaceId);
    if (workspace === null) {
      return null;
    }

    const now = this.#clock();
    const beforeLifecycle = this.evaluateWorkspace(workspace);
    const operationRequest = {
      workspaceId,
      operationKind: "lifecycle",
      action: operation,
      actor,
      metadata: {
        phase: "phase1",
        lifecycleState: beforeLifecycle.state,
        blockers: beforeLifecycle.blockers,
      },
    } as const;
    const policy = this.#security.createWorkspacePolicy(workspace);
    const policyDecision = evaluateWorkspaceOperationPolicy(policy, operationRequest);

    await this.#recordLifecycleAuditEvent({
      operation: operationRequest,
      eventType: "policy_evaluated",
      decision: policyDecision,
      metadata: {
        phase: "phase1",
        lifecycleState: beforeLifecycle.state,
        blockers: beforeLifecycle.blockers,
      },
    });

    const lifecycleBlockers = buildOperationBlockers(beforeLifecycle, isImplemented);
    if (policyDecision.outcome === "denied" || lifecycleBlockers.length > 0) {
      const decision = policyDecision.outcome === "denied"
        ? policyDecision
        : denyDecision(
          lifecycleBlockers[0] ?? "workspace_not_ready",
          buildLifecycleDenialMessage(operation, lifecycleBlockers),
        );
      const deniedResult = buildLifecycleDecision({
        workspaceId,
        operation,
        accepted: false,
        implemented: isImplemented,
        lifecycle: beforeLifecycle,
        blockers: lifecycleBlockers,
        evaluatedAt: now,
      });

      await this.#recordLifecycleAuditEvent({
        operation: operationRequest,
        eventType: "operation_denied",
        decision,
        metadata: {
          phase: "phase1",
          lifecycleState: beforeLifecycle.state,
          blockers: lifecycleBlockers,
          implemented: isImplemented,
        },
      });
      return deniedResult;
    }

    await this.#recordLifecycleAuditEvent({
      operation: operationRequest,
      eventType: "operation_started",
      decision: allowDecision("Workspace lifecycle operation accepted."),
      metadata: {
        phase: "phase1",
        lifecycleState: beforeLifecycle.state,
      },
    });

    commit(workspace, now);
    const afterWorkspace = this.#workspaceRegistry.getWorkspace(workspaceId) ?? workspace;
    const afterLifecycle = this.evaluateWorkspace(afterWorkspace);
    const acceptedResult = buildLifecycleDecision({
      workspaceId,
      operation,
      accepted: true,
      implemented: isImplemented,
      lifecycle: afterLifecycle,
      blockers: [],
      evaluatedAt: this.#clock(),
    });

    await this.#recordLifecycleAuditEvent({
      operation: operationRequest,
      eventType: "operation_succeeded",
      decision: allowDecision("Workspace lifecycle operation completed."),
      metadata: {
        phase: "phase1",
        lifecycleState: afterLifecycle.state,
        implemented: isImplemented,
      },
    });

    return acceptedResult;
  }

  async #recordLifecycleAuditEvent(input: Parameters<typeof createAuditEvent>[0]): Promise<void> {
    await this.#security.auditRecorder.record(createAuditEvent(input, {
      now: this.#clock(),
      logMasker: this.#security.logMasker,
    }));
  }
}

export function isWorkspaceExpired(
  workspace: Pick<Workspace, "expiresAt">,
  now: Date = new Date(),
): boolean {
  if (workspace.expiresAt === null) {
    return false;
  }

  return now.getTime() >= Date.parse(workspace.expiresAt);
}

export function evaluateWorkspaceLifecycle({
  workspace,
  metadata,
  now = new Date(),
}: {
  workspace: Workspace;
  metadata: WorkspaceLifecycleMetadata;
  now?: Date;
}): WorkspaceLifecycleSnapshot {
  const expired = isWorkspaceExpired(workspace, now);
  const dirty = metadata.dirtyState !== "clean";
  const busy = metadata.busyState === "busy";
  const blockers = buildLifecycleBlockers({ workspace, expired, dirty, busy, metadata });
  const reusable = workspace.status === "ready" && blockers.length === 0;

  return workspaceLifecycleSnapshotSchema.parse({
    workspaceId: workspace.workspaceId,
    workspaceStatus: workspace.status,
    state: chooseLifecycleState({ workspace, expired, dirty, busy, reusable }),
    reusable,
    expired,
    dirty,
    dirtyState: metadata.dirtyState,
    busy,
    busyState: metadata.busyState,
    blockers,
    evaluatedAt: now.toISOString(),
    expiresAt: workspace.expiresAt,
    lastClaimedAt: metadata.lastClaimedAt,
    lastReusedAt: metadata.lastReusedAt,
    lastResetAt: metadata.lastResetAt,
    lastCleanedAt: metadata.lastCleanedAt,
  });
}

function buildLifecycleBlockers({
  workspace,
  expired,
  dirty,
  busy,
  metadata,
}: {
  workspace: Workspace;
  expired: boolean;
  dirty: boolean;
  busy: boolean;
  metadata: WorkspaceLifecycleMetadata;
}): WorkspaceLifecycleBlocker[] {
  const blockers: WorkspaceLifecycleBlocker[] = [];

  if (workspace.status === "deleted") {
    blockers.push("workspace_deleted");
  } else if (workspace.status === "failed") {
    blockers.push("workspace_failed");
  } else if (workspace.status !== "ready") {
    blockers.push("workspace_not_ready");
  }

  if (expired) {
    blockers.push("workspace_expired");
  }

  if (busy) {
    blockers.push("workspace_busy");
  }

  if (dirty) {
    blockers.push(metadata.dirtyState === "unknown" ? "dirty_state_unknown" : "workspace_dirty");
  }

  return blockers;
}

function chooseLifecycleState({
  workspace,
  expired,
  dirty,
  busy,
  reusable,
}: {
  workspace: Workspace;
  expired: boolean;
  dirty: boolean;
  busy: boolean;
  reusable: boolean;
}): WorkspaceLifecycleSnapshot["state"] {
  if (workspace.status === "deleted") {
    return "deleted";
  }

  if (workspace.status === "failed") {
    return "failed";
  }

  if (workspace.status === "creating") {
    return "creating";
  }

  if (busy) {
    return "busy";
  }

  if (expired) {
    return "expired";
  }

  if (dirty) {
    return "dirty";
  }

  return reusable ? "reusable" : "ready";
}

function buildOperationBlockers(
  lifecycle: WorkspaceLifecycleSnapshot,
  isImplemented: boolean,
): WorkspaceLifecycleBlocker[] {
  const blockers = [...lifecycle.blockers];

  if (!isImplemented) {
    blockers.push("operation_not_implemented_in_phase1");
  }

  return blockers;
}

function buildLifecycleDecision(input: {
  workspaceId: string;
  operation: WorkspaceLifecycleOperation;
  accepted: boolean;
  implemented: boolean;
  lifecycle: WorkspaceLifecycleSnapshot;
  blockers: WorkspaceLifecycleBlocker[];
  evaluatedAt: Date;
}): WorkspaceLifecycleDecision {
  return workspaceLifecycleDecisionSchema.parse({
    ...input,
    evaluatedAt: input.evaluatedAt.toISOString(),
  });
}

function buildLifecycleDenialMessage(
  operation: WorkspaceLifecycleOperation,
  blockers: readonly WorkspaceLifecycleBlocker[],
): string {
  if (blockers.includes("operation_not_implemented_in_phase1")) {
    return `${operation} is a Phase 1 service boundary and does not perform workspace reset or clean side effects yet.`;
  }

  return `${operation} is blocked by the current workspace lifecycle state.`;
}
