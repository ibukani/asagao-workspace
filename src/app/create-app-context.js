import { WorkspaceRegistry } from "../services/workspace-registry.js";
import { InMemoryWorkspaceStore } from "../storage/in-memory-workspace-store.js";

export function createAppContext({
  clock = () => new Date(),
  createWorkspaceId,
} = {}) {
  const workspaceStore = new InMemoryWorkspaceStore();
  const workspaceRegistry = new WorkspaceRegistry({
    store: workspaceStore,
    clock,
    createId: createWorkspaceId,
  });

  return Object.freeze({
    workspaceStore,
    workspaceRegistry,
  });
}
