import {
  workspaceLifecycleMetadataSchema,
  type WorkspaceBusyState,
  type WorkspaceDirtyState,
  type WorkspaceLifecycleMetadata,
} from "../domain/index.ts";

export type WorkspaceLifecycleStore = {
  get: (workspaceId: string) => WorkspaceLifecycleMetadata | null;
  save: (metadata: WorkspaceLifecycleMetadata) => WorkspaceLifecycleMetadata;
  getOrCreate: (workspaceId: string, now: Date) => WorkspaceLifecycleMetadata;
};

export class InMemoryWorkspaceLifecycleStore implements WorkspaceLifecycleStore {
  readonly #metadata = new Map<string, WorkspaceLifecycleMetadata>();

  get(workspaceId: string): WorkspaceLifecycleMetadata | null {
    return this.#metadata.get(workspaceId) ?? null;
  }

  getOrCreate(workspaceId: string, now: Date): WorkspaceLifecycleMetadata {
    const existing = this.get(workspaceId);
    if (existing !== null) {
      return existing;
    }

    return this.save(createWorkspaceLifecycleMetadata(workspaceId, now));
  }

  save(metadata: WorkspaceLifecycleMetadata): WorkspaceLifecycleMetadata {
    const parsed = workspaceLifecycleMetadataSchema.parse(metadata);
    this.#metadata.set(parsed.workspaceId, parsed);
    return parsed;
  }

  list(): WorkspaceLifecycleMetadata[] {
    return [...this.#metadata.values()];
  }

  clear(): void {
    this.#metadata.clear();
  }
}

export function createWorkspaceLifecycleMetadata(
  workspaceId: string,
  now: Date,
): WorkspaceLifecycleMetadata {
  const timestamp = now.toISOString();
  return workspaceLifecycleMetadataSchema.parse({
    workspaceId,
    dirtyState: "clean",
    busyState: "idle",
    createdAt: timestamp,
    updatedAt: timestamp,
    lastClaimedAt: null,
    lastReusedAt: null,
    lastResetAt: null,
    lastCleanedAt: null,
  });
}

export function updateWorkspaceDirtyState(
  metadata: WorkspaceLifecycleMetadata,
  dirtyState: WorkspaceDirtyState,
  now: Date,
): WorkspaceLifecycleMetadata {
  return workspaceLifecycleMetadataSchema.parse({
    ...metadata,
    dirtyState,
    updatedAt: now.toISOString(),
  });
}

export function updateWorkspaceBusyState(
  metadata: WorkspaceLifecycleMetadata,
  busyState: WorkspaceBusyState,
  now: Date,
): WorkspaceLifecycleMetadata {
  return workspaceLifecycleMetadataSchema.parse({
    ...metadata,
    busyState,
    updatedAt: now.toISOString(),
  });
}

export function markWorkspaceClaimed(
  metadata: WorkspaceLifecycleMetadata,
  now: Date,
): WorkspaceLifecycleMetadata {
  const timestamp = now.toISOString();
  return workspaceLifecycleMetadataSchema.parse({
    ...metadata,
    updatedAt: timestamp,
    lastClaimedAt: timestamp,
    lastReusedAt: timestamp,
  });
}

export function markWorkspaceResetBoundaryObserved(
  metadata: WorkspaceLifecycleMetadata,
  now: Date,
): WorkspaceLifecycleMetadata {
  const timestamp = now.toISOString();
  return workspaceLifecycleMetadataSchema.parse({
    ...metadata,
    updatedAt: timestamp,
    lastResetAt: timestamp,
  });
}

export function markWorkspaceCleanBoundaryObserved(
  metadata: WorkspaceLifecycleMetadata,
  now: Date,
): WorkspaceLifecycleMetadata {
  const timestamp = now.toISOString();
  return workspaceLifecycleMetadataSchema.parse({
    ...metadata,
    updatedAt: timestamp,
    lastCleanedAt: timestamp,
  });
}
