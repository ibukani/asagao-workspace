export class InMemoryWorkspaceStore {
  #workspaces = new Map();

  save(workspace) {
    this.#workspaces.set(workspace.workspaceId, workspace);
    return workspace;
  }

  get(workspaceId) {
    return this.#workspaces.get(workspaceId) ?? null;
  }

  list({ includeDeleted = false } = {}) {
    const workspaces = [...this.#workspaces.values()];

    if (includeDeleted) {
      return workspaces;
    }

    return workspaces.filter((workspace) => workspace.status !== "deleted");
  }

  clear() {
    this.#workspaces.clear();
  }
}
