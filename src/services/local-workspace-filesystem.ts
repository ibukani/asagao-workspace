import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import {
  WORKSPACE_PATH_ERROR_CODES,
  WorkspacePathBoundaryError,
  WorkspacePathResolver,
} from "../filesystem/workspace-paths.ts";

export const LOCAL_WORKSPACE_FILESYSTEM_ERROR_CODES = {
  rootUnavailable: "workspace_root_unavailable",
  rootNotDirectory: "workspace_root_not_directory",
  rootNotWritable: "workspace_root_not_writable",
  createDirectoryFailed: "workspace_directory_create_failed",
  deleteDirectoryFailed: "workspace_directory_delete_failed",
} as const;

export type LocalWorkspaceFilesystemErrorCode =
  (typeof LOCAL_WORKSPACE_FILESYSTEM_ERROR_CODES)[keyof typeof LOCAL_WORKSPACE_FILESYSTEM_ERROR_CODES];

export class LocalWorkspaceFilesystemError extends Error {
  readonly code: LocalWorkspaceFilesystemErrorCode;
  readonly workspaceId: string | null;

  constructor(
    code: LocalWorkspaceFilesystemErrorCode,
    message: string,
    { workspaceId = null, cause }: { workspaceId?: string | null; cause?: unknown } = {},
  ) {
    super(message, { cause });
    this.name = "LocalWorkspaceFilesystemError";
    this.code = code;
    this.workspaceId = workspaceId;
  }
}

export type LocalWorkspaceFilesystemOptions = {
  workspaceRoot: string;
};

export class LocalWorkspaceFilesystem {
  readonly #paths: WorkspacePathResolver;

  constructor({ workspaceRoot }: LocalWorkspaceFilesystemOptions) {
    this.#paths = new WorkspacePathResolver({ workspaceRoot });
  }

  get workspaceRoot(): string {
    return this.#paths.workspaceRoot;
  }

  ensureWorkspaceRoot(): void {
    try {
      if (existsSync(this.workspaceRoot)) {
        const rootStat = lstatSync(this.workspaceRoot);
        if (!rootStat.isDirectory()) {
          throw new LocalWorkspaceFilesystemError(
            LOCAL_WORKSPACE_FILESYSTEM_ERROR_CODES.rootNotDirectory,
            `Workspace root exists but is not a directory: ${this.workspaceRoot}`,
          );
        }

        assertWorkspaceRootWritable(this.workspaceRoot);
        return;
      }

      mkdirSync(this.workspaceRoot, { recursive: true });
      assertWorkspaceRootWritable(this.workspaceRoot);
    } catch (error) {
      if (error instanceof LocalWorkspaceFilesystemError) {
        throw error;
      }

      throw new LocalWorkspaceFilesystemError(
        LOCAL_WORKSPACE_FILESYSTEM_ERROR_CODES.rootUnavailable,
        `Workspace root is unavailable: ${this.workspaceRoot}`,
        { cause: error },
      );
    }
  }

  createWorkspaceDirectory(workspaceId: string): void {
    try {
      this.ensureWorkspaceRoot();
      const workspaceDirectory = this.#paths.resolveWorkspaceDirectory(workspaceId);
      mkdirSync(workspaceDirectory, { recursive: false });
    } catch (error) {
      throw new LocalWorkspaceFilesystemError(
        LOCAL_WORKSPACE_FILESYSTEM_ERROR_CODES.createDirectoryFailed,
        `Failed to create workspace directory for ${workspaceId}.`,
        { workspaceId, cause: error },
      );
    }
  }

  deleteWorkspaceDirectory(workspaceId: string): void {
    try {
      const workspaceDirectory = this.#paths.resolveWorkspaceDirectory(workspaceId);
      this.#paths.assertPathInsideWorkspace(workspaceId, workspaceDirectory);

      if (!existsSync(workspaceDirectory)) {
        return;
      }

      assertDeletableWorkspaceDirectory(workspaceDirectory, workspaceId);
      rmSync(workspaceDirectory, { recursive: true, force: false });
    } catch (error) {
      throw new LocalWorkspaceFilesystemError(
        LOCAL_WORKSPACE_FILESYSTEM_ERROR_CODES.deleteDirectoryFailed,
        `Failed to delete workspace directory for ${workspaceId}.`,
        { workspaceId, cause: error },
      );
    }
  }
}

function assertDeletableWorkspaceDirectory(
  workspaceDirectory: string,
  workspaceId: string,
): void {
  const workspaceStat = lstatSync(workspaceDirectory);

  if (!workspaceStat.isDirectory()) {
    throw new WorkspacePathBoundaryError(
      WORKSPACE_PATH_ERROR_CODES.pathOutsideWorkspace,
      `Workspace path is not a directory and will not be removed: ${workspaceId}`,
    );
  }
}

function assertWorkspaceRootWritable(workspaceRoot: string): void {
  try {
    accessSync(workspaceRoot, constants.W_OK);
  } catch (error) {
    throw new LocalWorkspaceFilesystemError(
      LOCAL_WORKSPACE_FILESYSTEM_ERROR_CODES.rootNotWritable,
      `Workspace root is not writable: ${workspaceRoot}`,
      { cause: error },
    );
  }
}
