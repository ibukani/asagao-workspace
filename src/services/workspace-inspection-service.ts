import {
  toolError,
  type ToolFailure,
  type Workspace,
  type WorkspaceFileTreeData,
  type WorkspaceReadFileData,
  type WorkspaceSearchData,
} from "../domain/index.ts";
import { WorkspacePathBoundaryError } from "../filesystem/workspace-paths.ts";
import { runAuditedOperation, RunnerOperationDeniedError } from "../security/audit.ts";
import { evaluateWorkspaceOperationPolicy, normalizeWorkspaceRelativePath, type SecurityActor } from "../security/policy.ts";
import type { RunnerSecurityServices } from "../security/services.ts";
import {
  LOCAL_WORKSPACE_FILESYSTEM_ERROR_CODES,
  LocalWorkspaceFilesystem,
  LocalWorkspaceFilesystemError,
} from "./local-workspace-filesystem.ts";
import { type Clock, type WorkspaceRegistry } from "./workspace-registry.ts";

export const WORKSPACE_INSPECTION_DEFAULT_LIMITS = {
  fileTreeMaxDepth: 4,
  fileTreeMaxEntries: 500,
  readMaxLines: 400,
  readMaxBytes: 200_000,
  searchMaxResults: 50,
  searchMaxFileBytes: 200_000,
  searchMaxLineTextBytes: 500,
} as const;

export const WORKSPACE_INSPECTION_HARD_LIMITS = {
  fileTreeMaxDepth: 20,
  fileTreeMaxEntries: 5_000,
  readMaxLines: 2_000,
  readMaxBytes: 1_000_000,
  searchMaxResults: 200,
  searchMaxFileBytes: 1_000_000,
  searchMaxLineTextBytes: 2_000,
} as const;

export const WORKSPACE_INSPECTION_ERROR_CODES = {
  invalidInput: "invalid_input",
  workspaceNotFound: "workspace_not_found",
  workspaceUnavailable: "workspace_unavailable",
  operationDenied: "operation_denied",
  pathDenied: "path_denied",
  fileNotFound: "file_not_found",
  notAFile: "not_a_file",
  notADirectory: "not_a_directory",
  binaryFileNotReadable: "binary_file_not_readable",
  unsupportedFileType: "unsupported_file_type",
  filesystemUnavailable: "filesystem_unavailable",
} as const;

export type WorkspaceInspectionErrorCode =
  (typeof WORKSPACE_INSPECTION_ERROR_CODES)[keyof typeof WORKSPACE_INSPECTION_ERROR_CODES];

export class WorkspaceInspectionServiceError extends Error {
  readonly code: WorkspaceInspectionErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: WorkspaceInspectionErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "WorkspaceInspectionServiceError";
    this.code = code;
    this.details = details;
  }
}

export type WorkspaceInspectionServiceOptions = {
  workspaceRegistry: WorkspaceRegistry;
  workspaceFilesystem: LocalWorkspaceFilesystem;
  security: RunnerSecurityServices;
  clock?: Clock;
};

export type GetWorkspaceFileTreeRequest = {
  workspaceId: string;
  rootPath?: string;
  maxDepth?: number;
  maxEntries?: number;
  includeFiles?: boolean;
  actor?: SecurityActor;
};

export type ReadWorkspaceFileRequest = {
  workspaceId: string;
  path: string;
  startLine?: number;
  maxLines?: number;
  maxBytes?: number;
  actor?: SecurityActor;
};

export type SearchWorkspaceRequest = {
  workspaceId: string;
  query: string;
  rootPath?: string;
  caseSensitive?: boolean;
  maxResults?: number;
  maxFileBytes?: number;
  actor?: SecurityActor;
};

export class WorkspaceInspectionService {
  readonly #workspaceRegistry: WorkspaceRegistry;
  readonly #workspaceFilesystem: LocalWorkspaceFilesystem;
  readonly #security: RunnerSecurityServices;
  readonly #clock: Clock;

  constructor({
    workspaceRegistry,
    workspaceFilesystem,
    security,
    clock = () => new Date(),
  }: WorkspaceInspectionServiceOptions) {
    this.#workspaceRegistry = workspaceRegistry;
    this.#workspaceFilesystem = workspaceFilesystem;
    this.#security = security;
    this.#clock = clock;
  }

  async getFileTree(input: GetWorkspaceFileTreeRequest): Promise<WorkspaceFileTreeData> {
    const workspace = this.#requireInspectableWorkspace(input.workspaceId);
    const rootPath = normalizeInspectionRootPath(input.rootPath ?? ".");
    const maxDepth = clampLimit(
      input.maxDepth ?? WORKSPACE_INSPECTION_DEFAULT_LIMITS.fileTreeMaxDepth,
      0,
      WORKSPACE_INSPECTION_HARD_LIMITS.fileTreeMaxDepth,
    );
    const maxEntries = clampLimit(
      input.maxEntries ?? WORKSPACE_INSPECTION_DEFAULT_LIMITS.fileTreeMaxEntries,
      1,
      WORKSPACE_INSPECTION_HARD_LIMITS.fileTreeMaxEntries,
    );
    const policy = this.#security.createWorkspacePolicy(workspace);

    return this.#runFileOperation({
      workspace,
      action: "list_files",
      rootOrRelativePath: rootPath,
      actor: input.actor ?? "assistant",
      metadata: {
        rootPath,
        maxDepth,
        maxEntries,
        includeFiles: input.includeFiles ?? true,
      },
      execute: () => {
        const tree = this.#workspaceFilesystem.listWorkspaceFileTree({
          workspaceId: workspace.workspaceId,
          rootPath,
          maxDepth,
          maxEntries,
          deniedPathPrefixes: policy.file.deniedPathPrefixes,
        });

        if (input.includeFiles === false) {
          return {
            ...tree,
            entries: tree.entries.filter((entry) => entry.type !== "file"),
          };
        }

        return tree;
      },
    });
  }

  async readFile(input: ReadWorkspaceFileRequest): Promise<WorkspaceReadFileData> {
    const workspace = this.#requireInspectableWorkspace(input.workspaceId);
    const path = normalizeInspectionRelativePath(input.path);
    const policy = this.#security.createWorkspacePolicy(workspace);
    const maxPolicyBytes = Math.min(policy.file.maxReadBytes, WORKSPACE_INSPECTION_HARD_LIMITS.readMaxBytes);
    const maxBytes = clampLimit(
      input.maxBytes ?? WORKSPACE_INSPECTION_DEFAULT_LIMITS.readMaxBytes,
      1,
      maxPolicyBytes,
    );
    const maxLines = clampLimit(
      input.maxLines ?? WORKSPACE_INSPECTION_DEFAULT_LIMITS.readMaxLines,
      1,
      WORKSPACE_INSPECTION_HARD_LIMITS.readMaxLines,
    );
    const startLine = input.startLine ?? 1;

    const file = await this.#runFileOperation({
      workspace,
      action: "read_file",
      rootOrRelativePath: path,
      actor: input.actor ?? "assistant",
      metadata: {
        path,
        startLine,
        maxLines,
        maxBytes,
      },
      execute: () => this.#workspaceFilesystem.readWorkspaceTextFile({
        workspaceId: workspace.workspaceId,
        path,
        startLine,
        maxLines,
        maxBytes,
      }),
    });

    return {
      workspaceId: workspace.workspaceId,
      file,
      limits: {
        maxLines,
        maxBytes,
      },
    };
  }

  async searchWorkspace(input: SearchWorkspaceRequest): Promise<WorkspaceSearchData> {
    const workspace = this.#requireInspectableWorkspace(input.workspaceId);
    const rootPath = normalizeInspectionRootPath(input.rootPath ?? ".");
    const policy = this.#security.createWorkspacePolicy(workspace);
    const maxPolicyBytes = Math.min(policy.file.maxReadBytes, WORKSPACE_INSPECTION_HARD_LIMITS.searchMaxFileBytes);
    const maxResults = clampLimit(
      input.maxResults ?? WORKSPACE_INSPECTION_DEFAULT_LIMITS.searchMaxResults,
      1,
      WORKSPACE_INSPECTION_HARD_LIMITS.searchMaxResults,
    );
    const maxFileBytes = clampLimit(
      input.maxFileBytes ?? WORKSPACE_INSPECTION_DEFAULT_LIMITS.searchMaxFileBytes,
      1,
      maxPolicyBytes,
    );
    const caseSensitive = input.caseSensitive ?? false;

    return this.#runFileOperation({
      workspace,
      action: "search_files",
      rootOrRelativePath: rootPath,
      actor: input.actor ?? "assistant",
      metadata: {
        rootPath,
        queryLength: input.query.length,
        caseSensitive,
        maxResults,
        maxFileBytes,
      },
      execute: () => this.#workspaceFilesystem.searchWorkspaceText({
        workspaceId: workspace.workspaceId,
        rootPath,
        query: input.query,
        caseSensitive,
        maxResults,
        maxFileBytes,
        maxLineTextBytes: WORKSPACE_INSPECTION_DEFAULT_LIMITS.searchMaxLineTextBytes,
        deniedPathPrefixes: policy.file.deniedPathPrefixes,
      }),
    });
  }

  #requireInspectableWorkspace(workspaceId: string): Workspace {
    const workspace = this.#workspaceRegistry.getWorkspace(workspaceId);
    if (workspace === null) {
      throw new WorkspaceInspectionServiceError(
        WORKSPACE_INSPECTION_ERROR_CODES.workspaceNotFound,
        "Workspace not found.",
        { workspaceId },
      );
    }

    if (workspace.status !== "ready") {
      throw new WorkspaceInspectionServiceError(
        WORKSPACE_INSPECTION_ERROR_CODES.workspaceUnavailable,
        "Workspace is not ready for file inspection.",
        { workspaceId, status: workspace.status },
      );
    }

    return workspace;
  }

  async #runFileOperation<Result>({
    workspace,
    action,
    rootOrRelativePath,
    actor,
    metadata,
    execute,
  }: {
    workspace: Workspace;
    action: "list_files" | "read_file" | "search_files";
    rootOrRelativePath: string;
    actor: SecurityActor;
    metadata: Record<string, unknown>;
    execute: () => Result;
  }): Promise<Result> {
    const policy = this.#security.createWorkspacePolicy(workspace);
    const operation = {
      workspaceId: workspace.workspaceId,
      operationKind: "file",
      action,
      actor,
      ...(rootOrRelativePath === "." ? {} : { relativePath: rootOrRelativePath }),
      metadata,
    } as const;

    try {
      return await runAuditedOperation({
        recorder: this.#security.auditRecorder,
        operation,
        evaluatePolicy: () => evaluateWorkspaceOperationPolicy(policy, operation),
        execute,
        now: this.#clock,
        logMasker: this.#security.logMasker,
      });
    } catch (error) {
      throw toWorkspaceInspectionServiceError(error, workspace.workspaceId);
    }
  }
}

export function toWorkspaceInspectionToolFailure(error: unknown): ToolFailure {
  if (error instanceof WorkspaceInspectionServiceError) {
    return toolError(error.code, error.message, error.details);
  }

  return toolError(
    WORKSPACE_INSPECTION_ERROR_CODES.filesystemUnavailable,
    "Workspace inspection operation failed.",
    { message: error instanceof Error ? error.message : String(error) },
  );
}

function toWorkspaceInspectionServiceError(
  error: unknown,
  workspaceId: string,
): WorkspaceInspectionServiceError {
  if (error instanceof WorkspaceInspectionServiceError) {
    return error;
  }

  if (error instanceof RunnerOperationDeniedError) {
    const code = error.decision.reasonCode === "path_denied"
      ? WORKSPACE_INSPECTION_ERROR_CODES.pathDenied
      : WORKSPACE_INSPECTION_ERROR_CODES.operationDenied;
    return new WorkspaceInspectionServiceError(
      code,
      error.decision.message ?? "Workspace file operation denied by policy.",
      {
        workspaceId,
        reasonCode: error.decision.reasonCode,
        action: error.operation.action,
        relativePath: error.operation.relativePath,
      },
    );
  }

  if (error instanceof LocalWorkspaceFilesystemError) {
    const boundaryError = findWorkspacePathBoundaryError(error);
    if (boundaryError !== null) {
      return new WorkspaceInspectionServiceError(
        WORKSPACE_INSPECTION_ERROR_CODES.pathDenied,
        boundaryError.message,
        { workspaceId, reasonCode: boundaryError.code },
      );
    }

    return mapFilesystemError(error, workspaceId);
  }

  return new WorkspaceInspectionServiceError(
    WORKSPACE_INSPECTION_ERROR_CODES.filesystemUnavailable,
    "Workspace filesystem operation failed.",
    { workspaceId, message: error instanceof Error ? error.message : String(error) },
  );
}

function findWorkspacePathBoundaryError(error: unknown): WorkspacePathBoundaryError | null {
  let current: unknown = error;

  while (current instanceof Error) {
    if (current instanceof WorkspacePathBoundaryError) {
      return current;
    }

    current = current.cause;
  }

  return null;
}

function mapFilesystemError(
  error: LocalWorkspaceFilesystemError,
  workspaceId: string,
): WorkspaceInspectionServiceError {
  switch (error.code) {
    case LOCAL_WORKSPACE_FILESYSTEM_ERROR_CODES.pathNotFound:
      return new WorkspaceInspectionServiceError(
        WORKSPACE_INSPECTION_ERROR_CODES.fileNotFound,
        "Workspace path not found.",
        { workspaceId, message: error.message },
      );
    case LOCAL_WORKSPACE_FILESYSTEM_ERROR_CODES.notAFile:
      return new WorkspaceInspectionServiceError(
        WORKSPACE_INSPECTION_ERROR_CODES.notAFile,
        "Workspace path is not a file.",
        { workspaceId, message: error.message },
      );
    case LOCAL_WORKSPACE_FILESYSTEM_ERROR_CODES.notADirectory:
      return new WorkspaceInspectionServiceError(
        WORKSPACE_INSPECTION_ERROR_CODES.notADirectory,
        "Workspace path is not a directory.",
        { workspaceId, message: error.message },
      );
    case LOCAL_WORKSPACE_FILESYSTEM_ERROR_CODES.binaryFileNotReadable:
      return new WorkspaceInspectionServiceError(
        WORKSPACE_INSPECTION_ERROR_CODES.binaryFileNotReadable,
        "Binary files are not readable through read_file.",
        { workspaceId, message: error.message },
      );
    case LOCAL_WORKSPACE_FILESYSTEM_ERROR_CODES.unsupportedFileType:
      return new WorkspaceInspectionServiceError(
        WORKSPACE_INSPECTION_ERROR_CODES.unsupportedFileType,
        "Workspace path has an unsupported file type.",
        { workspaceId, message: error.message },
      );
    default:
      return new WorkspaceInspectionServiceError(
        WORKSPACE_INSPECTION_ERROR_CODES.filesystemUnavailable,
        "Workspace filesystem operation failed.",
        { workspaceId, code: error.code, message: error.message },
      );
  }
}

function normalizeInspectionRootPath(rawPath: string): string {
  if (rawPath === "." || rawPath.trim() === "") {
    return ".";
  }

  return normalizeInspectionRelativePath(rawPath);
}

function normalizeInspectionRelativePath(rawPath: string): string {
  const normalizedPath = normalizeWorkspaceRelativePath(rawPath);
  if (!normalizedPath.success) {
    throw new WorkspaceInspectionServiceError(
      WORKSPACE_INSPECTION_ERROR_CODES.pathDenied,
      normalizedPath.message,
      { reasonCode: normalizedPath.reasonCode, path: rawPath },
    );
  }

  return normalizedPath.relativePath;
}

function clampLimit(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
