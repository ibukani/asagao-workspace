import { randomUUID } from "node:crypto";
import {
  createWorkspaceModel,
  markWorkspaceDeleted,
} from "../domain/workspace.js";

export class WorkspaceRegistry {
  constructor({ store, clock = () => new Date(), createId = createWorkspaceId }) {
    this.store = store;
    this.clock = clock;
    this.createId = createId;
  }

  createWorkspace(input = {}) {
    const workspace = createWorkspaceModel(
      {
        workspaceId: this.createId(),
        workspaceName: input.workspaceName,
        status: "ready",
        source: buildRepositorySource(input),
        defaultBranch: input.branch,
        workingBranch: input.branch,
        runtimeProfile: input.runtimeProfile,
        internetPolicy: input.internetPolicy,
        ttlMinutes: input.ttlMinutes,
      },
      { now: this.clock() },
    );

    return this.store.save(workspace);
  }

  listWorkspaces({ includeDeleted = false } = {}) {
    return this.store.list({ includeDeleted });
  }

  getWorkspace(workspaceId) {
    return this.store.get(workspaceId);
  }

  deleteWorkspace(workspaceId) {
    const workspace = this.getWorkspace(workspaceId);

    if (!workspace) {
      return null;
    }

    if (workspace.status === "deleted") {
      return workspace;
    }

    return this.store.save(markWorkspaceDeleted(workspace, { deletedAt: this.clock() }));
  }
}

export function createWorkspaceId() {
  return `ws_${randomUUID()}`;
}

function buildRepositorySource(input) {
  if (!input.repoUrl) {
    return null;
  }

  return {
    type: "git",
    repoUrl: input.repoUrl,
    branch: input.branch ?? null,
    baseRef: input.baseRef ?? null,
  };
}
