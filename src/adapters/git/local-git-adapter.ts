import { closeSync, existsSync, lstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import type {
  GitChangedFile,
  WorkspaceDiffPatch,
  WorkspaceDiffStat,
} from "../../domain/index.ts";
import { isBinaryFile } from "../files/binary-detector.ts";
import { ExecaProcessRunner, type ProcessRunner, type ProcessRunnerResult } from "../process/index.ts";
import { safeCommand, truncateUtf8 } from "../safe-metadata.ts";
import {
  GIT_ADAPTER_ERROR_CODES,
  GitAdapterError,
  type GetWorkspaceDiffSnapshotOptions,
  type GitAdapter,
  type GitDiffSnapshot,
  type GitRepositoryMetadata,
  type GitStatusSnapshot,
} from "./git-adapter.ts";
import { parseGitNumstatZ, parseGitStatusPorcelainZ, type GitNumstatEntry } from "./git-parsers.ts";

const GIT_TIMEOUT_MS = 15_000;
const STDERR_LIMIT_BYTES = 16_384;
const SMALL_STDOUT_LIMIT_BYTES = 5_000_000;

export class LocalGitAdapter implements GitAdapter {
  readonly #processRunner: ProcessRunner;

  constructor(processRunner: ProcessRunner = new ExecaProcessRunner()) {
    this.#processRunner = processRunner;
  }

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

    if (result.failureKind === "spawn") {
      throw new GitAdapterError({
        code: GIT_ADAPTER_ERROR_CODES.gitUnavailable,
        message: "Git executable is unavailable.",
        details: { command: safeCommand(result.command) },
      });
    }

    if (result.exitCode !== 0 || result.stdout.trim() !== "true") {
      throw new GitAdapterError({
        code: GIT_ADAPTER_ERROR_CODES.notGitWorkspace,
        message: "Workspace directory is not a git work tree.",
        details: {
          command: safeCommand(result.command),
          exitCode: result.exitCode,
          signal: result.signal,
          stderr: result.stderr,
          stderrTruncated: result.stderrTruncated,
        },
      });
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
    const trackedPatchPrefix = truncateUtf8(trackedPatch.stdout, maxPatchBytes).content;
    const remainingPatchBytes = Math.max(0, maxPatchBytes - Buffer.byteLength(trackedPatchPrefix, "utf8"));
    const generatedPatch = buildUntrackedPatch(workspaceDirectory, changedFiles, remainingPatchBytes);
    const separator = trackedPatchPrefix.length > 0 && generatedPatch.content.length > 0 ? "\n" : "";
    const combined = `${trackedPatchPrefix}${separator}${generatedPatch.content}`;
    const combinedPrefix = truncateUtf8(combined, maxPatchBytes);
    const truncated = trackedPatch.stdoutTruncated
      || Buffer.byteLength(trackedPatch.stdout, "utf8") > maxPatchBytes
      || generatedPatch.truncated
      || combinedPrefix.truncated;

    return {
      included: true,
      content: combinedPrefix.content,
      truncated,
      returnedBytes: Buffer.byteLength(combinedPrefix.content, "utf8"),
      maxBytes: maxPatchBytes,
      ...(truncated ? { omittedReason: "max_patch_bytes" as const } : {}),
    };
  }

  async #runGitText(
    workspaceDirectory: string,
    args: readonly string[],
    options: { rejectOnFailure?: boolean } = {},
  ): Promise<ProcessRunnerResult> {
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
  ): Promise<ProcessRunnerResult> {
    const result = await this.#processRunner.run({
      executable: "git",
      args,
      cwd: workspaceDirectory,
      timeoutMs: GIT_TIMEOUT_MS,
      maxStdoutBytes,
      maxStderrBytes: STDERR_LIMIT_BYTES,
    });

    if (result.failed && rejectOnFailure) {
      if (result.failureKind === "spawn") {
        throw new GitAdapterError({
          code: GIT_ADAPTER_ERROR_CODES.gitUnavailable,
          message: "Git executable is unavailable.",
          details: { command: safeCommand(result.command) },
        });
      }

      throw new GitAdapterError({
        code: GIT_ADAPTER_ERROR_CODES.gitCommandFailed,
        message: "Git command failed.",
        details: {
          command: safeCommand(result.command),
          exitCode: result.exitCode,
          signal: result.signal,
          timedOut: result.timedOut,
          cancelled: result.cancelled,
          stderr: result.stderr,
          stdoutTruncated: result.stdoutTruncated,
          stderrTruncated: result.stderrTruncated,
        },
      });
    }

    return result;
  }
}

function mergeFileStatistics(
  files: readonly GitChangedFile[],
  numstatEntries: readonly GitNumstatEntry[],
  untrackedSummaries: readonly GitNumstatEntry[],
): GitChangedFile[] {
  const byPath = new Map<string, GitNumstatEntry>();
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
): GitNumstatEntry[] {
  return files
    .filter((file) => file.untracked)
    .map((file) => summarizeUntrackedFile(workspaceDirectory, file.path));
}

function summarizeUntrackedFile(workspaceDirectory: string, path: string): GitNumstatEntry {
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

  return {
    path,
    additions: countTextFileLines(absolutePath),
    deletions: 0,
    binary: false,
  };
}

function buildUntrackedPatch(
  workspaceDirectory: string,
  files: readonly GitChangedFile[],
  maxPatchBytes: number,
): { content: string; truncated: boolean } {
  const patches: string[] = [];
  let remainingBytes = maxPatchBytes;
  let truncated = false;
  for (const file of files) {
    if (!file.untracked) {
      continue;
    }

    if (remainingBytes <= 0) {
      truncated = true;
      break;
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
      const binaryPatch = truncateUtf8([
        `diff --git a/${file.path} b/${file.path}`,
        "new file mode 100644",
        "index 0000000..0000000",
        `Binary files /dev/null and b/${file.path} differ`,
      ].join("\n"), remainingBytes).content;
      patches.push(binaryPatch);
      remainingBytes -= Buffer.byteLength(binaryPatch, "utf8");
      truncated ||= Buffer.byteLength(binaryPatch, "utf8") === 0;
      continue;
    }

    const header = [
      `diff --git a/${file.path} b/${file.path}`,
      "new file mode 100644",
      "index 0000000..0000000",
      "--- /dev/null",
      `+++ b/${file.path}`,
      `@@ -0,0 +1,${file.additions ?? 0} @@`,
    ].join("\n");
    const separatorBytes = patches.length > 0 ? Buffer.byteLength("\n", "utf8") : 0;
    const headerBytes = Buffer.byteLength(header, "utf8");
    if (separatorBytes + headerBytes > remainingBytes) {
      truncated = true;
      break;
    }

    const contentBudget = remainingBytes - separatorBytes - headerBytes;
    const prefix = readTextFilePrefix(absolutePath, contentBudget);
    const lines = prefix.content.length === 0 ? [] : prefix.content.split("\n");
    if (lines.at(-1) === "") {
      lines.pop();
    }

    const textPatch = [
      header,
      ...lines.map((line) => `+${line}`),
    ].join("\n");
    const boundedPatch = truncateUtf8(textPatch, remainingBytes - separatorBytes).content;
    patches.push(boundedPatch);
    remainingBytes -= separatorBytes + Buffer.byteLength(boundedPatch, "utf8");
    truncated ||= prefix.truncated || Buffer.byteLength(textPatch, "utf8") > Buffer.byteLength(boundedPatch, "utf8");
  }

  return { content: patches.join("\n"), truncated };
}

function countTextFileLines(absolutePath: string): number {
  const fd = openSync(absolutePath, "r");
  const buffer = Buffer.alloc(64 * 1024);
  let lineCount = 0;
  let sawBytes = false;
  let lastByte = -1;

  try {
    for (;;) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) {
        break;
      }

      sawBytes = true;
      for (let index = 0; index < bytesRead; index += 1) {
        if (buffer[index] === 0x0a) {
          lineCount += 1;
        }
      }
      lastByte = buffer[bytesRead - 1] ?? -1;
    }
  } finally {
    closeSync(fd);
  }

  return sawBytes && lastByte !== 0x0a ? lineCount + 1 : lineCount;
}

function readTextFilePrefix(absolutePath: string, maxBytes: number): { content: string; truncated: boolean } {
  if (maxBytes <= 0) {
    return { content: "", truncated: true };
  }

  const fd = openSync(absolutePath, "r");
  const buffer = Buffer.alloc(maxBytes + 1);

  try {
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    const truncated = bytesRead > maxBytes;
    return {
      content: truncateUtf8(buffer.subarray(0, Math.min(bytesRead, maxBytes)).toString("utf8"), maxBytes).content,
      truncated,
    };
  } finally {
    closeSync(fd);
  }
}
