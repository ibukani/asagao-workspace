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

export type WorkspaceFilesystem = {
  createWorkspaceDirectory: (workspaceId: string) => void;
  deleteWorkspaceDirectory: (workspaceId: string) => void;
};

export const WORKSPACE_REGISTRY_ERROR_CODES = {
  filesystemOperationFailed: "workspace_filesystem_operation_failed",
} as const;

export type WorkspaceRegistryErrorCode =
  (typeof WORKSPACE_REGISTRY_ERROR_CODES)[keyof typeof WORKSPACE_REGISTRY_ERROR_CODES];

export class WorkspaceRegistryError extends Error {
  readonly code: WorkspaceRegistryErrorCode;
  readonly operation: "create" | "delete";
  readonly workspaceId: string;

  constructor(
    code: WorkspaceRegistryErrorCode,
    message: string,
    {
      operation,
      workspaceId,
      cause,
    }: { operation: "create" | "delete"; workspaceId: string; cause?: unknown },
  ) {
    super(message, { cause });
    this.name = "WorkspaceRegistryError";
    this.code = code;
    this.operation = operation;
    this.workspaceId = workspaceId;
  }
}

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
  filesystem?: WorkspaceFilesystem;
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
  readonly #filesystem: WorkspaceFilesystem | null;
  readonly #clock: Clock;
  readonly #createId: WorkspaceIdFactory;

  constructor({
    store,
    filesystem,
    clock = () => new Date(),
    createId = createWorkspaceId,
  }: CreateWorkspaceRegistryOptions) {
    this.#store = store;
    this.#filesystem = filesystem ?? null;
    this.#clock = clock;
    this.#createId = createId;
  }

  createWorkspace(input: CreateWorkspaceRequest = {}): Workspace {
    const workspace = createWorkspaceModel(this.#buildWorkspaceModelInput(input), {
      now: this.#clock(),
    });
    const creatingWorkspace = this.#store.save(workspace);

    if (this.#filesystem === null) {
      return this.#store.save(
        updateWorkspaceStatus(creatingWorkspace, {
          status: "ready",
          updatedAt: this.#clock(),
        }),
      );
    }

    try {
      this.#filesystem.createWorkspaceDirectory(creatingWorkspace.workspaceId);
    } catch (error) {
      this.#store.save(
        updateWorkspaceStatus(creatingWorkspace, {
          status: "failed",
          updatedAt: this.#clock(),
        }),
      );
      throw new WorkspaceRegistryError(
        WORKSPACE_REGISTRY_ERROR_CODES.filesystemOperationFailed,
        `Failed to create local filesystem workspace for ${creatingWorkspace.workspaceId}.`,
        {
          operation: "create",
          workspaceId: creatingWorkspace.workspaceId,
          cause: error,
        },
      );
    }

    return this.#store.save(
      updateWorkspaceStatus(creatingWorkspace, {
        status: "ready",
        updatedAt: this.#clock(),
      }),
    );
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

    if (this.#filesystem !== null) {
      try {
        this.#filesystem.deleteWorkspaceDirectory(workspace.workspaceId);
      } catch (error) {
        throw new WorkspaceRegistryError(
          WORKSPACE_REGISTRY_ERROR_CODES.filesystemOperationFailed,
          `Failed to delete local filesystem workspace for ${workspace.workspaceId}.`,
          {
            operation: "delete",
            workspaceId: workspace.workspaceId,
            cause: error,
          },
        );
      }
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
      status: "creating",
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
