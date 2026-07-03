import type {
  GitChangedFile,
  GitChangedFileStatus,
} from "../../domain/index.ts";
import { normalizeWorkspaceRelativePath } from "../../security/policy.ts";
import { GIT_ADAPTER_ERROR_CODES, GitAdapterError } from "./git-adapter.ts";

export function parseGitStatusPorcelainZ(output: string): GitChangedFile[] {
  const records = output.split("\0").filter((record) => record.length > 0);
  const files: GitChangedFile[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? "";
    if (record.length < 3) {
      continue;
    }

    const indexStatus = record[0] ?? " ";
    const workTreeStatus = record[1] ?? " ";
    const rawPath = record.slice(3);
    let previousPath: string | undefined;
    let path = normalizeGitWorkspacePath(rawPath);

    if (indexStatus === "R" || indexStatus === "C") {
      const nextRecord = records[index + 1];
      if (nextRecord !== undefined) {
        previousPath = normalizeGitWorkspacePath(nextRecord);
        index += 1;
      } else if (rawPath.includes(" -> ")) {
        const [rawPreviousPath, rawNewPath] = rawPath.split(" -> ", 2);
        previousPath = normalizeGitWorkspacePath(rawPreviousPath ?? "");
        path = normalizeGitWorkspacePath(rawNewPath ?? rawPath);
      }
    }

    files.push({
      path,
      ...(previousPath === undefined ? {} : { previousPath }),
      status: classifyStatus(indexStatus, workTreeStatus),
      indexStatus: indexStatus === " " ? null : indexStatus,
      workTreeStatus: workTreeStatus === " " ? null : workTreeStatus,
      staged: indexStatus !== " " && indexStatus !== "?" && indexStatus !== "U",
      unstaged: workTreeStatus !== " " && workTreeStatus !== "?" && workTreeStatus !== "U",
      untracked: indexStatus === "?" && workTreeStatus === "?",
      conflicted: isConflictStatus(indexStatus, workTreeStatus),
    });
  }

  return files;
}

export type GitNumstatEntry = {
  path: string;
  additions?: number;
  deletions?: number;
  binary: boolean;
};

export function parseGitNumstatZ(output: string): GitNumstatEntry[] {
  const records = output.split("\0").filter((record) => record.length > 0);
  const entries: GitNumstatEntry[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? "";
    const [rawAdditions, rawDeletions, rawPath = ""] = record.split("\t");
    if (rawAdditions === undefined || rawDeletions === undefined) {
      continue;
    }

    const binary = rawAdditions === "-" || rawDeletions === "-";
    const path = rawPath.length > 0
      ? rawPath
      : records[index + 2] ?? records[index + 1] ?? "";

    if (rawPath.length === 0) {
      index += 2;
    }

    entries.push({
      path: normalizeGitWorkspacePath(path),
      ...(binary ? {} : { additions: Number.parseInt(rawAdditions, 10) }),
      ...(binary ? {} : { deletions: Number.parseInt(rawDeletions, 10) }),
      binary,
    });
  }

  return entries;
}

export function classifyStatus(indexStatus: string, workTreeStatus: string): GitChangedFileStatus {
  if (indexStatus === "?" && workTreeStatus === "?") {
    return "untracked";
  }

  if (isConflictStatus(indexStatus, workTreeStatus)) {
    return "conflicted";
  }

  if (indexStatus === "R" || workTreeStatus === "R") {
    return "renamed";
  }

  if (indexStatus === "C" || workTreeStatus === "C") {
    return "copied";
  }

  if (indexStatus === "A" || workTreeStatus === "A") {
    return "added";
  }

  if (indexStatus === "D" || workTreeStatus === "D") {
    return "deleted";
  }

  if (indexStatus === "T" || workTreeStatus === "T") {
    return "type_changed";
  }

  if (indexStatus === "M" || workTreeStatus === "M") {
    return "modified";
  }

  return "unknown";
}

export function isConflictStatus(indexStatus: string, workTreeStatus: string): boolean {
  return ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(`${indexStatus}${workTreeStatus}`);
}

function normalizeGitWorkspacePath(rawPath: string): string {
  const normalized = normalizeWorkspaceRelativePath(rawPath);
  if (!normalized.success) {
    throw new GitAdapterError({
      code: GIT_ADAPTER_ERROR_CODES.gitCommandFailed,
      message: normalized.message,
      details: { reasonCode: normalized.reasonCode },
    });
  }

  return normalized.relativePath;
}
