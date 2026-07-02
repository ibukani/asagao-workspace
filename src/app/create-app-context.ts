import {
  WorkspaceRegistry,
  type Clock,
  type WorkspaceIdFactory,
} from "../services/workspace-registry.ts";
import { InMemoryWorkspaceStore } from "../storage/in-memory-workspace-store.ts";

export type AppServices = {
  workspaceStore: InMemoryWorkspaceStore;
  workspaceRegistry: WorkspaceRegistry;
};

export type CreateAppContextOptions = {
  clock?: Clock;
  createWorkspaceId?: WorkspaceIdFactory;
};

export function createAppContext({
  clock,
  createWorkspaceId,
}: CreateAppContextOptions = {}): AppServices {
  const workspaceStore = new InMemoryWorkspaceStore();
  const workspaceRegistry = new WorkspaceRegistry({
    store: workspaceStore,
    ...(clock === undefined ? {} : { clock }),
    ...(createWorkspaceId === undefined ? {} : { createId: createWorkspaceId }),
  });

  return Object.freeze({
    workspaceStore,
    workspaceRegistry,
  });
}
