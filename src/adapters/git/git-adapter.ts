import type {
  GitChangedFile,
  WorkspaceDiffPatch,
  WorkspaceDiffStat,
} from "../../domain/index.ts";
import { AdapterError, ADAPTER_ERROR_CODES, type AdapterErrorCode } from "../errors.ts";

export const GIT_ADAPTER_ERROR_CODES = {
  gitUnavailable: ADAPTER_ERROR_CODES.gitUnavailable,
  notGitWorkspace: ADAPTER_ERROR_CODES.notGitWorkspace,
  gitCommandFailed: ADAPTER_ERROR_CODES.gitCommandFailed,
} as const;

export type GitAdapterErrorCode = (typeof GIT_ADAPTER_ERROR_CODES)[keyof typeof GIT_ADAPTER_ERROR_CODES];

export class GitAdapterError extends AdapterError {
  declare readonly code: GitAdapterErrorCode;

  constructor({
    code,
    message,
    details = {},
    cause,
  }: {
    code: GitAdapterErrorCode;
    message: string;
    details?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super({
      operation: "git",
      code: code as AdapterErrorCode,
      message,
      details,
      cause,
      userActionable: code === GIT_ADAPTER_ERROR_CODES.notGitWorkspace,
    });
    this.name = "GitAdapterError";
  }
}

export type GitRepositoryMetadata = {
  branch: string | null;
  headCommit: string | null;
};

export type GitStatusSnapshot = GitRepositoryMetadata & {
  changedFiles: GitChangedFile[];
};

export type GitDiffSnapshot = GitStatusSnapshot & {
  diffstat: WorkspaceDiffStat;
  patch: WorkspaceDiffPatch;
};

export type GetWorkspaceDiffSnapshotOptions = {
  includePatch: boolean;
  maxPatchBytes: number;
};

export type GitAdapter = {
  getStatus: (workspaceDirectory: string) => Promise<GitStatusSnapshot>;
  getDiff: (
    workspaceDirectory: string,
    options: GetWorkspaceDiffSnapshotOptions,
  ) => Promise<GitDiffSnapshot>;
};
