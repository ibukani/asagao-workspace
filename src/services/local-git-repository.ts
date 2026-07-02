import { spawn } from "node:child_process";
import { existsSync, lstatSync, openSync, readFileSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import type {
  GitChangedFile,
  GitChangedFileStatus,
  WorkspaceDiffPatch,
  WorkspaceDiffStat,
} from "../domain/index.ts";
import { normalizeWorkspaceRelativePath } from "../security/policy.ts";

export const LOCAL_GIT_REPOSITORY_ERROR_CODES = {
  gitUnavailable: "git_unavailable",
  notGitWorkspace: "not_git_workspace",
  gitCommandFailed: "git_command_failed",
} as const;

export type LocalGitRepositoryErrorCode =
  (typeof LOCAL_GIT_REPOSITORY_ERROR_CODES)[keyof typeof LOCAL_GIT_REPOSITORY_ERROR_CODES];

export class LocalGitRepositoryError extends Error {
  readonly code: LocalGitRepositoryErrorCode;
  readonly command: readonly string[];
  readonly exitCode: number | null;
  readonly stderr: string;

  constructor(
    code: LocalGitRepositoryErrorCode,
    message: string,
    {
      command = [],
      exitCode = null,
      stderr = "",
      cause,
    }: {
      command?: readonly string[];
      exitCode?: number | null;
      stderr?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause });
    this.name = "LocalGitRepositoryError";
    this.code = code;
    this.command = command;
    this.exitCode = exitCode;
    this.stderr = stderr;
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

const GIT_TIMEOUT_MS = 15_000;
const STDERR_LIMIT_BYTES = 16_384;
const SMALL_STDOUT_LIMIT_BYTES = 5_000_000;

export class LocalGitRepository {
  async getStatus(workspaceDirectory: string): Promise<GitStatusSnapshot> {
    await this.#assertInsideWorkTree(workspaceDirectory);
    const [metadata, statusOutput] = await Promise.all([
      this.#readMetadata(workspaceDirectory),
      this.#runGitText(workspaceDirectory, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    ]);

    return {
      ...metadata,
      changedFiles: parseGitStatusPorcelainZ(statusOutput.stdout),
    };
  }

  async getDiff(
    workspaceDirectory: string,
    { includePatch, maxPatchBytes }: GetWorkspaceDiffSnapshotOptions,
  ): Promise<GitDiffSnapshot> {
    const status = await this.getStatus(workspaceDirectory);
    const trackedNumstat = await this.#runGitText(workspaceDirectory, ["diff", "--numstat", "-z", "HEAD", "--"]);
    const numstatEntries = parseGitNumstatZ(trackedNumstat.stdout);
    const untrackedSummaries = summarizeUntrackedFiles(workspaceDirectory, status.changedFiles);
    const changedFiles = mergeFileStatistics(status.changedFiles, numstatEntries, untrackedSummaries);
    const diffstat = calculateDiffStat(changedFiles);
    const patch = includePatch
      ? await this.#buildPatch(workspaceDirectory, changedFiles, maxPatchBytes)
      : {
        included: false,
        content: "",
        truncated: false,
        returnedBytes: 0,
        maxBytes: maxPatchBytes,
        omittedReason: "not_requested" as const,
      };

    return {
      ...status,
      changedFiles,
      diffstat,
      patch,
    };
  }

  async #assertInsideWorkTree(workspaceDirectory: string): Promise<void> {
    const result = await this.#runGit(workspaceDirectory, ["rev-parse", "--is-inside-work-tree"], {
      maxStdoutBytes: SMALL_STDOUT_LIMIT_BYTES,
      rejectOnFailure: false,
    });

    if (result.spawnError !== null) {
      throw new LocalGitRepositoryError(
        LOCAL_GIT_REPOSITORY_ERROR_CODES.gitUnavailable,
        "Git executable is unavailable.",
        { command: result.command, cause: result.spawnError },
      );
    }

    if (result.exitCode !== 0 || result.stdout.trim() !== "true") {
      throw new LocalGitRepositoryError(
        LOCAL_GIT_REPOSITORY_ERROR_CODES.notGitWorkspace,
        "Workspace directory is not a git work tree.",
        { command: result.command, exitCode: result.exitCode, stderr: result.stderr },
      );
    }
  }

  async #readMetadata(workspaceDirectory: string): Promise<GitRepositoryMetadata> {
    const [branch, headCommit] = await Promise.all([
      this.#runGitText(workspaceDirectory, ["rev-parse", "--abbrev-ref", "HEAD"], { rejectOnFailure: false }),
      this.#runGitText(workspaceDirectory, ["rev-parse", "HEAD"], { rejectOnFailure: false }),
    ]);

    return {
      branch: branch.exitCode === 0 && branch.stdout.trim() !== "HEAD"
        ? branch.stdout.trim()
        : null,
      headCommit: headCommit.exitCode === 0 && headCommit.stdout.trim() !== ""
        ? headCommit.stdout.trim()
        : null,
    };
  }

  async #buildPatch(
    workspaceDirectory: string,
    changedFiles: readonly GitChangedFile[],
    maxPatchBytes: number,
  ): Promise<WorkspaceDiffPatch> {
    const trackedPatch = await this.#runGit(workspaceDirectory, ["diff", "--binary", "HEAD", "--"], {
      maxStdoutBytes: maxPatchBytes + 1,
      rejectOnFailure: true,
    });
    const generatedPatch = buildUntrackedPatch(workspaceDirectory, changedFiles);
    const combined = `${trackedPatch.stdout}${trackedPatch.stdout.length > 0 && generatedPatch.length > 0 ? "\n" : ""}${generatedPatch}`;
    const truncated = trackedPatch.stdoutTruncated || Buffer.byteLength(combined, "utf8") > maxPatchBytes;
    const content = takeUtf8Prefix(combined, maxPatchBytes);

    return {
      included: true,
      content,
      truncated,
      returnedBytes: Buffer.byteLength(content, "utf8"),
      maxBytes: maxPatchBytes,
      ...(truncated ? { omittedReason: "max_patch_bytes" as const } : {}),
    };
  }

  async #runGitText(
    workspaceDirectory: string,
    args: readonly string[],
    options: { rejectOnFailure?: boolean } = {},
  ): Promise<GitCommandResult> {
    return this.#runGit(workspaceDirectory, args, {
      maxStdoutBytes: SMALL_STDOUT_LIMIT_BYTES,
      rejectOnFailure: options.rejectOnFailure ?? true,
    });
  }

  async #runGit(
    workspaceDirectory: string,
    args: readonly string[],
    {
      maxStdoutBytes,
      rejectOnFailure,
    }: {
      maxStdoutBytes: number;
      rejectOnFailure: boolean;
    },
  ): Promise<GitCommandResult> {
    const result = await runGitCommand(workspaceDirectory, args, { maxStdoutBytes });
    if (result.spawnError !== null || result.exitCode !== 0) {
      if (!rejectOnFailure) {
        return result;
      }

      if (result.spawnError !== null) {
        throw new LocalGitRepositoryError(
          LOCAL_GIT_REPOSITORY_ERROR_CODES.gitUnavailable,
          "Git executable is unavailable.",
          { command: result.command, cause: result.spawnError },
        );
      }

      throw new LocalGitRepositoryError(
        LOCAL_GIT_REPOSITORY_ERROR_CODES.gitCommandFailed,
        "Git command failed.",
        { command: result.command, exitCode: result.exitCode, stderr: result.stderr },
      );
    }

    return result;
  }
}

type GitCommandResult = {
  command: readonly string[];
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  exitCode: number | null;
  spawnError: Error | null;
};

function runGitCommand(
  workspaceDirectory: string,
  args: readonly string[],
  { maxStdoutBytes }: { maxStdoutBytes: number },
): Promise<GitCommandResult> {
  return new Promise((resolve) => {
    const command = ["git", ...args] as const;
    const child = spawn("git", [...args], {
      cwd: workspaceDirectory,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let settled = false;
    let spawnError: Error | null = null;

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
    }, GIT_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdoutBytes >= maxStdoutBytes) {
        stdoutTruncated = true;
        stdoutBytes += chunk.length;
        return;
      }

      const remaining = maxStdoutBytes - stdoutBytes;
      if (chunk.length <= remaining) {
        stdoutChunks.push(chunk);
      } else {
        stdoutChunks.push(chunk.subarray(0, remaining));
        stdoutTruncated = true;
      }
      stdoutBytes += chunk.length;
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrBytes >= STDERR_LIMIT_BYTES) {
        stderrBytes += chunk.length;
        return;
      }

      const remaining = STDERR_LIMIT_BYTES - stderrBytes;
      stderrChunks.push(chunk.length <= remaining ? chunk : chunk.subarray(0, remaining));
      stderrBytes += chunk.length;
    });

    child.on("error", (error) => {
      spawnError = error;
    });

    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({
        command,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        stdoutTruncated,
        exitCode,
        spawnError,
      });
    });
  });
}

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

type NumstatEntry = {
  path: string;
  additions?: number;
  deletions?: number;
  binary: boolean;
};

export function parseGitNumstatZ(output: string): NumstatEntry[] {
  const records = output.split("\0").filter((record) => record.length > 0);
  const entries: NumstatEntry[] = [];

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

function classifyStatus(indexStatus: string, workTreeStatus: string): GitChangedFileStatus {
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

function isConflictStatus(indexStatus: string, workTreeStatus: string): boolean {
  return ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(`${indexStatus}${workTreeStatus}`);
}

function mergeFileStatistics(
  files: readonly GitChangedFile[],
  numstatEntries: readonly NumstatEntry[],
  untrackedSummaries: readonly NumstatEntry[],
): GitChangedFile[] {
  const byPath = new Map<string, NumstatEntry>();
  for (const entry of [...numstatEntries, ...untrackedSummaries]) {
    byPath.set(entry.path, entry);
  }

  return files.map((file) => {
    const entry = byPath.get(file.path);
    if (entry === undefined) {
      return file;
    }

    return {
      ...file,
      binary: entry.binary,
      ...(entry.additions === undefined ? {} : { additions: entry.additions }),
      ...(entry.deletions === undefined ? {} : { deletions: entry.deletions }),
    };
  });
}

function calculateDiffStat(files: readonly GitChangedFile[]): WorkspaceDiffStat {
  return files.reduce<WorkspaceDiffStat>(
    (diffstat, file) => ({
      filesChanged: diffstat.filesChanged + 1,
      additions: diffstat.additions + (file.additions ?? 0),
      deletions: diffstat.deletions + (file.deletions ?? 0),
      binaryFiles: diffstat.binaryFiles + (file.binary ? 1 : 0),
    }),
    { filesChanged: 0, additions: 0, deletions: 0, binaryFiles: 0 },
  );
}

function summarizeUntrackedFiles(
  workspaceDirectory: string,
  files: readonly GitChangedFile[],
): NumstatEntry[] {
  return files
    .filter((file) => file.untracked)
    .map((file) => summarizeUntrackedFile(workspaceDirectory, file.path));
}

function summarizeUntrackedFile(workspaceDirectory: string, path: string): NumstatEntry {
  const absolutePath = join(workspaceDirectory, path);
  if (!existsSync(absolutePath)) {
    return { path, additions: 0, deletions: 0, binary: false };
  }

  const stat = lstatSync(absolutePath);
  if (!stat.isFile()) {
    return { path, additions: 0, deletions: 0, binary: false };
  }

  if (isBinaryFile(absolutePath)) {
    return { path, binary: true };
  }

  const content = readFileSync(absolutePath, "utf8");
  const additions = content.length === 0 ? 0 : content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
  return { path, additions, deletions: 0, binary: false };
}

function buildUntrackedPatch(workspaceDirectory: string, files: readonly GitChangedFile[]): string {
  const patches: string[] = [];
  for (const file of files) {
    if (!file.untracked) {
      continue;
    }

    const absolutePath = join(workspaceDirectory, file.path);
    if (!existsSync(absolutePath)) {
      continue;
    }

    const stat = lstatSync(absolutePath);
    if (!stat.isFile()) {
      continue;
    }

    if (file.binary || isBinaryFile(absolutePath)) {
      patches.push([
        `diff --git a/${file.path} b/${file.path}`,
        "new file mode 100644",
        "index 0000000..0000000",
        `Binary files /dev/null and b/${file.path} differ`,
      ].join("\n"));
      continue;
    }

    const content = readFileSync(absolutePath, "utf8");
    const lines = content.length === 0 ? [] : content.split("\n");
    if (lines.at(-1) === "") {
      lines.pop();
    }

    patches.push([
      `diff --git a/${file.path} b/${file.path}`,
      "new file mode 100644",
      "index 0000000..0000000",
      "--- /dev/null",
      `+++ b/${file.path}`,
      `@@ -0,0 +1,${lines.length} @@`,
      ...lines.map((line) => `+${line}`),
    ].join("\n"));
  }

  return patches.join("\n");
}

function normalizeGitWorkspacePath(rawPath: string): string {
  const normalized = normalizeWorkspaceRelativePath(rawPath);
  if (!normalized.success) {
    throw new LocalGitRepositoryError(
      LOCAL_GIT_REPOSITORY_ERROR_CODES.gitCommandFailed,
      normalized.message,
      { stderr: normalized.message },
    );
  }

  return normalized.relativePath;
}

function isBinaryFile(absolutePath: string): boolean {
  const fd = openSync(absolutePath, "r");
  const buffer = Buffer.alloc(8_192);

  try {
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } finally {
    closeSync(fd);
  }
}

function takeUtf8Prefix(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) {
    return value;
  }

  let bytes = 0;
  let endIndex = 0;
  for (const character of value) {
    const nextBytes = Buffer.byteLength(character, "utf8");
    if (bytes + nextBytes > maxBytes) {
      break;
    }

    bytes += nextBytes;
    endIndex += character.length;
  }

  return value.slice(0, endIndex);
}
