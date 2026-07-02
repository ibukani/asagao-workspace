import { existsSync, realpathSync } from "node:fs";
import {
  dirname,
  isAbsolute,
  parse,
  relative,
  resolve,
} from "node:path";
import { workspaceIdSchema } from "../domain/index.ts";

export const DEFAULT_WORKSPACE_ROOT = ".asagao/workspaces";

export const WORKSPACE_PATH_ERROR_CODES = {
  invalidWorkspaceRoot: "invalid_workspace_root",
  invalidWorkspaceId: "invalid_workspace_id",
  invalidRelativePath: "invalid_relative_path",
  pathOutsideWorkspaceRoot: "path_outside_workspace_root",
  pathOutsideWorkspace: "path_outside_workspace",
  symlinkEscapesWorkspaceRoot: "symlink_escapes_workspace_root",
  symlinkEscapesWorkspace: "symlink_escapes_workspace",
} as const;

export type WorkspacePathErrorCode =
  (typeof WORKSPACE_PATH_ERROR_CODES)[keyof typeof WORKSPACE_PATH_ERROR_CODES];

export class WorkspacePathBoundaryError extends Error {
  readonly code: WorkspacePathErrorCode;

  constructor(code: WorkspacePathErrorCode, message: string) {
    super(message);
    this.name = "WorkspacePathBoundaryError";
    this.code = code;
  }
}

export type WorkspacePathResolverOptions = {
  workspaceRoot: string;
};

export class WorkspacePathResolver {
  readonly workspaceRoot: string;

  constructor({ workspaceRoot }: WorkspacePathResolverOptions) {
    this.workspaceRoot = normalizeWorkspaceRootPath(workspaceRoot);
  }

  resolveWorkspaceDirectory(workspaceId: string): string {
    assertWorkspaceId(workspaceId);
    const workspaceDirectory = resolve(this.workspaceRoot, workspaceId);

    assertPathInsideBoundary(
      this.workspaceRoot,
      workspaceDirectory,
      WORKSPACE_PATH_ERROR_CODES.pathOutsideWorkspaceRoot,
      `Workspace directory must stay under workspace root: ${workspaceId}`,
    );
    assertExistingPathInsideBoundary(
      this.workspaceRoot,
      workspaceDirectory,
      WORKSPACE_PATH_ERROR_CODES.symlinkEscapesWorkspaceRoot,
      `Workspace directory symlink escapes workspace root: ${workspaceId}`,
    );

    return workspaceDirectory;
  }

  resolveWorkspaceRelativePath(workspaceId: string, relativePath: string): string {
    assertRelativePath(relativePath);
    const workspaceDirectory = this.resolveWorkspaceDirectory(workspaceId);
    const candidatePath = resolve(workspaceDirectory, relativePath);

    assertPathInsideBoundary(
      workspaceDirectory,
      candidatePath,
      WORKSPACE_PATH_ERROR_CODES.pathOutsideWorkspace,
      `Workspace relative path escapes its workspace: ${relativePath}`,
    );
    assertExistingPathInsideBoundary(
      workspaceDirectory,
      candidatePath,
      WORKSPACE_PATH_ERROR_CODES.symlinkEscapesWorkspace,
      `Workspace relative path resolves through a symlink outside its workspace: ${relativePath}`,
    );

    return candidatePath;
  }

  assertPathInsideWorkspace(workspaceId: string, candidatePath: string): void {
    if (candidatePath.includes("\0")) {
      throw new WorkspacePathBoundaryError(
        WORKSPACE_PATH_ERROR_CODES.invalidRelativePath,
        "Workspace path must not contain NUL bytes.",
      );
    }

    const workspaceDirectory = this.resolveWorkspaceDirectory(workspaceId);
    const absoluteCandidatePath = resolve(candidatePath);

    assertPathInsideBoundary(
      workspaceDirectory,
      absoluteCandidatePath,
      WORKSPACE_PATH_ERROR_CODES.pathOutsideWorkspace,
      `Path must stay under workspace directory: ${workspaceId}`,
    );
    assertExistingPathInsideBoundary(
      workspaceDirectory,
      absoluteCandidatePath,
      WORKSPACE_PATH_ERROR_CODES.symlinkEscapesWorkspace,
      `Path resolves through a symlink outside workspace directory: ${workspaceId}`,
    );
  }
}

export function normalizeWorkspaceRootPath(rawWorkspaceRoot: string): string {
  if (rawWorkspaceRoot.trim() === "") {
    throw new WorkspacePathBoundaryError(
      WORKSPACE_PATH_ERROR_CODES.invalidWorkspaceRoot,
      "Workspace root must not be empty.",
    );
  }

  if (rawWorkspaceRoot.includes("\0")) {
    throw new WorkspacePathBoundaryError(
      WORKSPACE_PATH_ERROR_CODES.invalidWorkspaceRoot,
      "Workspace root must not contain NUL bytes.",
    );
  }

  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(rawWorkspaceRoot)) {
    throw new WorkspacePathBoundaryError(
      WORKSPACE_PATH_ERROR_CODES.invalidWorkspaceRoot,
      "Workspace root must be a filesystem path, not a URL.",
    );
  }

  const absoluteWorkspaceRoot = resolve(rawWorkspaceRoot);
  if (absoluteWorkspaceRoot === parse(absoluteWorkspaceRoot).root) {
    throw new WorkspacePathBoundaryError(
      WORKSPACE_PATH_ERROR_CODES.invalidWorkspaceRoot,
      "Workspace root must not be the filesystem root.",
    );
  }

  return absoluteWorkspaceRoot;
}

function assertWorkspaceId(workspaceId: string): void {
  const parsed = workspaceIdSchema.safeParse(workspaceId);
  if (!parsed.success) {
    throw new WorkspacePathBoundaryError(
      WORKSPACE_PATH_ERROR_CODES.invalidWorkspaceId,
      `Invalid workspaceId for filesystem path resolution: ${workspaceId}`,
    );
  }
}

function assertRelativePath(relativePath: string): void {
  if (relativePath.includes("\0")) {
    throw new WorkspacePathBoundaryError(
      WORKSPACE_PATH_ERROR_CODES.invalidRelativePath,
      "Workspace relative path must not contain NUL bytes.",
    );
  }

  if (relativePath.trim() === "") {
    throw new WorkspacePathBoundaryError(
      WORKSPACE_PATH_ERROR_CODES.invalidRelativePath,
      "Workspace relative path must not be empty.",
    );
  }

  if (isAbsolute(relativePath)) {
    throw new WorkspacePathBoundaryError(
      WORKSPACE_PATH_ERROR_CODES.invalidRelativePath,
      `Workspace relative path must not be absolute: ${relativePath}`,
    );
  }
}

function assertPathInsideBoundary(
  boundaryPath: string,
  candidatePath: string,
  code: WorkspacePathErrorCode,
  message: string,
): void {
  const relativePath = relative(boundaryPath, candidatePath);
  if (relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))) {
    return;
  }

  throw new WorkspacePathBoundaryError(code, message);
}

function assertExistingPathInsideBoundary(
  boundaryPath: string,
  candidatePath: string,
  code: WorkspacePathErrorCode,
  message: string,
): void {
  const existingBoundary = nearestExistingPath(boundaryPath);
  if (existingBoundary === null) {
    return;
  }

  const existingCandidate = nearestExistingPath(candidatePath);
  if (existingCandidate === null) {
    return;
  }

  const realBoundaryPath = realpathSync(existingBoundary);
  const realCandidatePath = realpathSync(existingCandidate);

  assertPathInsideBoundary(realBoundaryPath, realCandidatePath, code, message);
}

function nearestExistingPath(path: string): string | null {
  let candidate = resolve(path);

  while (!existsSync(candidate)) {
    const parent = dirname(candidate);
    if (parent === candidate) {
      return null;
    }

    candidate = parent;
  }

  return candidate;
}
