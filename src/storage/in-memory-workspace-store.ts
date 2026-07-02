import type {
  RuntimeProfile,
  Workspace,
  WorkspaceStatus,
} from "../domain/index.ts";

export type WorkspaceListFilters = {
  includeDeleted?: boolean;
  status?: readonly WorkspaceStatus[];
  runtimeProfile?: readonly RuntimeProfile[];
};

export class InMemoryWorkspaceStore {
  readonly #workspaces = new Map<string, Workspace>();

  save(workspace: Workspace): Workspace {
    this.#workspaces.set(workspace.workspaceId, workspace);
    return workspace;
  }

  get(workspaceId: string): Workspace | null {
    return this.#workspaces.get(workspaceId) ?? null;
  }

  list({
    includeDeleted = false,
    status,
    runtimeProfile,
  }: WorkspaceListFilters = {}): Workspace[] {
    return [...this.#workspaces.values()].filter((workspace) => {
      if (!includeDeleted && workspace.status === "deleted") {
        return false;
      }

      if (status !== undefined && !status.includes(workspace.status)) {
        return false;
      }

      if (
        runtimeProfile !== undefined &&
        !runtimeProfile.includes(workspace.runtimeProfile)
      ) {
        return false;
      }

      return true;
    });
  }

  clear(): void {
    this.#workspaces.clear();
  }
}
