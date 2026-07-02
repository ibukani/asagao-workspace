import { randomUUID } from "node:crypto";
import {
  createWorkspaceModel,
  markWorkspaceDeleted,
  updateWorkspaceStatus,
  type CreateWorkspaceModelInput,
  type InternetPolicy,
  type RuntimeProfile,
  type Workspace,
  type WorkspaceSource,
  type WorkspaceStatus,
} from "../domain/index.ts";
import type { WorkspaceListFilters } from "../storage/in-memory-workspace-store.ts";

export type Clock = () => Date;
export type WorkspaceIdFactory = () => string;

export type WorkspaceStore = {
  save: (workspace: Workspace) => Workspace;
  get: (workspaceId: string) => Workspace | null;
  list: (filters?: WorkspaceListFilters) => Workspace[];
};

export type CreateWorkspaceRequest = {
  repoUrl?: string;
  branch?: string;
  baseRef?: string;
  workspaceName?: string;
  runtimeProfile?: RuntimeProfile;
  internetPolicy?: InternetPolicy;
  ttlMinutes?: number;
};

export type CreateWorkspaceRegistryOptions = {
  store: WorkspaceStore;
  clock?: Clock;
  createId?: WorkspaceIdFactory;
};

export type ListWorkspacesOptions = {
  includeDeleted?: boolean;
  status?: readonly WorkspaceStatus[];
  runtimeProfile?: readonly RuntimeProfile[];
};

export class WorkspaceRegistry {
  readonly #store: WorkspaceStore;
  readonly #clock: Clock;
  readonly #createId: WorkspaceIdFactory;

  constructor({
    store,
    clock = () => new Date(),
    createId = createWorkspaceId,
  }: CreateWorkspaceRegistryOptions) {
    this.#store = store;
    this.#clock = clock;
    this.#createId = createId;
  }

  createWorkspace(input: CreateWorkspaceRequest = {}): Workspace {
    const workspace = createWorkspaceModel(this.#buildWorkspaceModelInput(input), {
      now: this.#clock(),
    });

    return this.#store.save(workspace);
  }

  listWorkspaces(options: ListWorkspacesOptions = {}): Workspace[] {
    return this.#store.list(options);
  }

  getWorkspace(workspaceId: string): Workspace | null {
    return this.#store.get(workspaceId);
  }

  setWorkspaceStatus(
    workspaceId: string,
    status: WorkspaceStatus,
  ): Workspace | null {
    const workspace = this.getWorkspace(workspaceId);

    if (workspace === null) {
      return null;
    }

    return this.#store.save(
      updateWorkspaceStatus(workspace, { status, updatedAt: this.#clock() }),
    );
  }

  deleteWorkspace(workspaceId: string): Workspace | null {
    const workspace = this.getWorkspace(workspaceId);

    if (workspace === null) {
      return null;
    }

    if (workspace.status === "deleted") {
      return workspace;
    }

    return this.#store.save(
      markWorkspaceDeleted(workspace, { deletedAt: this.#clock() }),
    );
  }

  #buildWorkspaceModelInput(input: CreateWorkspaceRequest): CreateWorkspaceModelInput {
    const source = buildWorkspaceSource(input);

    return {
      workspaceId: this.#createId(),
      name: input.workspaceName,
      status: "ready",
      source,
      runtimeProfile: input.runtimeProfile,
      internetPolicy: input.internetPolicy,
      ttlMinutes: input.ttlMinutes,
      defaultBranch: source.type === "git" ? source.branch ?? null : null,
      workingBranch: source.type === "git" ? source.branch ?? null : null,
    };
  }
}

export function createWorkspaceId(): string {
  return `wks_${randomUUID()}`;
}

function buildWorkspaceSource(input: CreateWorkspaceRequest): WorkspaceSource {
  if (input.repoUrl === undefined) {
    return { type: "empty" };
  }

  return {
    type: "git",
    repoUrl: input.repoUrl,
    ...(input.branch === undefined ? {} : { branch: input.branch }),
    ...(input.baseRef === undefined ? {} : { baseRef: input.baseRef }),
  };
}
