import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  type Stats,
} from "node:fs";
import { relative, sep } from "node:path";
import { TextDecoder } from "node:util";
import {
  WORKSPACE_PATH_ERROR_CODES,
  WorkspacePathBoundaryError,
  WorkspacePathResolver,
} from "../filesystem/workspace-paths.ts";
import type {
  WorkspaceFileEntryType,
  WorkspaceFileTreeData,
  WorkspaceFileTreeEntry,
  WorkspaceSearchData,
  WorkspaceSearchMatch,
  WorkspaceTextFileRead,
} from "../domain/index.ts";

export const LOCAL_WORKSPACE_FILESYSTEM_ERROR_CODES = {
  rootUnavailable: "workspace_root_unavailable",
  rootNotDirectory: "workspace_root_not_directory",
  rootNotWritable: "workspace_root_not_writable",
  createDirectoryFailed: "workspace_directory_create_failed",
  deleteDirectoryFailed: "workspace_directory_delete_failed",
  listFilesFailed: "workspace_file_list_failed",
  readFileFailed: "workspace_file_read_failed",
  searchFilesFailed: "workspace_file_search_failed",
  pathNotFound: "workspace_path_not_found",
  notAFile: "workspace_path_not_file",
  notADirectory: "workspace_path_not_directory",
  binaryFileNotReadable: "workspace_binary_file_not_readable",
  unsupportedFileType: "workspace_unsupported_file_type",
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

export type ListWorkspaceFileTreeOptions = {
  workspaceId: string;
  rootPath: string;
  maxDepth: number;
  maxEntries: number;
  deniedPathPrefixes?: readonly string[];
};

export type ReadWorkspaceTextFileOptions = {
  workspaceId: string;
  path: string;
  startLine: number;
  maxLines: number;
  maxBytes: number;
};

export type SearchWorkspaceTextOptions = {
  workspaceId: string;
  rootPath: string;
  query: string;
  caseSensitive: boolean;
  maxResults: number;
  maxFileBytes: number;
  maxLineTextBytes: number;
  deniedPathPrefixes?: readonly string[];
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

  resolveWorkspaceDirectoryForOperation(workspaceId: string): string {
    return this.#paths.resolveWorkspaceDirectory(workspaceId);
  }

  assertWorkspaceRelativePathInsideBoundary(workspaceId: string, relativePath: string): void {
    this.#paths.resolveWorkspaceRelativePath(workspaceId, relativePath);
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

  listWorkspaceFileTree({
    workspaceId,
    rootPath,
    maxDepth,
    maxEntries,
    deniedPathPrefixes = [],
  }: ListWorkspaceFileTreeOptions): WorkspaceFileTreeData {
    try {
      const workspaceDirectory = this.#paths.resolveWorkspaceDirectory(workspaceId);
      const rootAbsolutePath = this.#resolveInspectionPath(workspaceId, rootPath);
      const rootRelativePath = toWorkspaceRelativePath(workspaceDirectory, rootAbsolutePath);
      if (!existsSync(rootAbsolutePath)) {
        throw new LocalWorkspaceFilesystemError(
          LOCAL_WORKSPACE_FILESYSTEM_ERROR_CODES.pathNotFound,
          `Workspace path not found: ${rootRelativePath}`,
          { workspaceId },
        );
      }

      const rootStat = lstatSync(rootAbsolutePath);

      if (!rootStat.isDirectory()) {
        throw new LocalWorkspaceFilesystemError(
          LOCAL_WORKSPACE_FILESYSTEM_ERROR_CODES.notADirectory,
          `Workspace path is not a directory: ${rootRelativePath}`,
          { workspaceId },
        );
      }

      const entries: WorkspaceFileTreeEntry[] = [];
      let omittedCount = 0;
      let truncated = false;

      const visitDirectory = (absoluteDirectory: string, depth: number): void => {
        if (truncated) {
          return;
        }

        const children = readdirSync(absoluteDirectory, { withFileTypes: true })
          .sort((left, right) => left.name.localeCompare(right.name));

        if (depth >= maxDepth) {
          if (children.length > 0) {
            omittedCount += children.length;
            truncated = true;
          }
          return;
        }

        for (const child of children) {
          const childAbsolutePath = `${absoluteDirectory}${sep}${child.name}`;
          const childRelativePath = toWorkspaceRelativePath(workspaceDirectory, childAbsolutePath);

          if (pathMatchesDeniedPrefix(childRelativePath, deniedPathPrefixes)) {
            omittedCount += 1;
            continue;
          }

          const childStat = lstatSync(childAbsolutePath);
          const entry = toFileTreeEntry(childRelativePath, childStat, depth + 1);

          if (entries.length >= maxEntries) {
            omittedCount += 1;
            truncated = true;
            continue;
          }

          entries.push(entry);

          if (entry.type === "directory") {
            visitDirectory(childAbsolutePath, depth + 1);
          }
        }
      };

      visitDirectory(rootAbsolutePath, 0);

      return {
        workspaceId,
        rootPath: rootRelativePath,
        entries,
        truncated,
        omittedCount,
        limits: {
          maxDepth,
          maxEntries,
        },
      };
    } catch (error) {
      if (error instanceof LocalWorkspaceFilesystemError) {
        throw error;
      }

      throw new LocalWorkspaceFilesystemError(
        LOCAL_WORKSPACE_FILESYSTEM_ERROR_CODES.listFilesFailed,
        `Failed to list workspace file tree for ${workspaceId}.`,
        { workspaceId, cause: error },
      );
    }
  }

  readWorkspaceTextFile({
    workspaceId,
    path,
    startLine,
    maxLines,
    maxBytes,
  }: ReadWorkspaceTextFileOptions): WorkspaceTextFileRead {
    try {
      const workspaceDirectory = this.#paths.resolveWorkspaceDirectory(workspaceId);
      const absolutePath = this.#paths.resolveWorkspaceRelativePath(workspaceId, path);
      const relativePath = toWorkspaceRelativePath(workspaceDirectory, absolutePath);
      if (!existsSync(absolutePath)) {
        throw new LocalWorkspaceFilesystemError(
          LOCAL_WORKSPACE_FILESYSTEM_ERROR_CODES.pathNotFound,
          `Workspace path not found: ${relativePath}`,
          { workspaceId },
        );
      }

      const stat = lstatSync(absolutePath);

      if (!stat.isFile()) {
        throw new LocalWorkspaceFilesystemError(
          stat.isDirectory()
            ? LOCAL_WORKSPACE_FILESYSTEM_ERROR_CODES.notAFile
            : LOCAL_WORKSPACE_FILESYSTEM_ERROR_CODES.unsupportedFileType,
          `Workspace path is not a readable regular file: ${relativePath}`,
          { workspaceId },
        );
      }

      assertTextFile(absolutePath, workspaceId, relativePath);

      return readTextFileWithinLimits({
        absolutePath,
        relativePath,
        sizeBytes: stat.size,
        startLine,
        maxLines,
        maxBytes,
      });
    } catch (error) {
      if (error instanceof LocalWorkspaceFilesystemError) {
        throw error;
      }

      throw new LocalWorkspaceFilesystemError(
        LOCAL_WORKSPACE_FILESYSTEM_ERROR_CODES.readFileFailed,
        `Failed to read workspace file for ${workspaceId}: ${path}`,
        { workspaceId, cause: error },
      );
    }
  }

  searchWorkspaceText({
    workspaceId,
    rootPath,
    query,
    caseSensitive,
    maxResults,
    maxFileBytes,
    maxLineTextBytes,
    deniedPathPrefixes = [],
  }: SearchWorkspaceTextOptions): WorkspaceSearchData {
    try {
      const workspaceDirectory = this.#paths.resolveWorkspaceDirectory(workspaceId);
      const rootAbsolutePath = this.#resolveInspectionPath(workspaceId, rootPath);
      const rootRelativePath = toWorkspaceRelativePath(workspaceDirectory, rootAbsolutePath);
      if (!existsSync(rootAbsolutePath)) {
        throw new LocalWorkspaceFilesystemError(
          LOCAL_WORKSPACE_FILESYSTEM_ERROR_CODES.pathNotFound,
          `Workspace path not found: ${rootRelativePath}`,
          { workspaceId },
        );
      }

      const rootStat = lstatSync(rootAbsolutePath);

      if (!rootStat.isDirectory()) {
        throw new LocalWorkspaceFilesystemError(
          LOCAL_WORKSPACE_FILESYSTEM_ERROR_CODES.notADirectory,
          `Workspace path is not a directory: ${rootRelativePath}`,
          { workspaceId },
        );
      }

      const matches: WorkspaceSearchMatch[] = [];
      const skippedFiles = {
        binary: 0,
        tooLarge: 0,
        denied: 0,
        unreadable: 0,
      };
      let searchedFiles = 0;
      let truncated = false;

      const visitDirectory = (absoluteDirectory: string): void => {
        if (truncated) {
          return;
        }

        const children = readdirSync(absoluteDirectory, { withFileTypes: true })
          .sort((left, right) => left.name.localeCompare(right.name));

        for (const child of children) {
          if (truncated) {
            return;
          }

          const childAbsolutePath = `${absoluteDirectory}${sep}${child.name}`;
          const childRelativePath = toWorkspaceRelativePath(workspaceDirectory, childAbsolutePath);

          if (pathMatchesDeniedPrefix(childRelativePath, deniedPathPrefixes)) {
            skippedFiles.denied += 1;
            continue;
          }

          const childStat = lstatSync(childAbsolutePath);
          if (childStat.isDirectory()) {
            visitDirectory(childAbsolutePath);
            continue;
          }

          if (!childStat.isFile()) {
            skippedFiles.unreadable += 1;
            continue;
          }

          if (childStat.size > maxFileBytes) {
            skippedFiles.tooLarge += 1;
            continue;
          }

          if (isBinaryFile(childAbsolutePath)) {
            skippedFiles.binary += 1;
            continue;
          }

          try {
            const fileMatches = searchTextFile({
              absolutePath: childAbsolutePath,
              relativePath: childRelativePath,
              query,
              caseSensitive,
              remainingResults: maxResults - matches.length,
              maxLineTextBytes,
            });
            searchedFiles += 1;
            matches.push(...fileMatches.matches);
            if (fileMatches.truncated || matches.length >= maxResults) {
              truncated = true;
            }
          } catch {
            skippedFiles.unreadable += 1;
          }
        }
      };

      visitDirectory(rootAbsolutePath);

      return {
        workspaceId,
        query,
        rootPath: rootRelativePath,
        caseSensitive,
        matches,
        truncated,
        searchedFiles,
        skippedFiles,
        limits: {
          maxResults,
          maxFileBytes,
          maxLineTextBytes,
        },
      };
    } catch (error) {
      if (error instanceof LocalWorkspaceFilesystemError) {
        throw error;
      }

      throw new LocalWorkspaceFilesystemError(
        LOCAL_WORKSPACE_FILESYSTEM_ERROR_CODES.searchFilesFailed,
        `Failed to search workspace files for ${workspaceId}.`,
        { workspaceId, cause: error },
      );
    }
  }

  #resolveInspectionPath(workspaceId: string, relativePath: string): string {
    if (isWorkspaceRootPath(relativePath)) {
      return this.#paths.resolveWorkspaceDirectory(workspaceId);
    }

    return this.#paths.resolveWorkspaceRelativePath(workspaceId, relativePath);
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

function assertTextFile(absolutePath: string, workspaceId: string, relativePath: string): void {
  if (!isBinaryFile(absolutePath)) {
    return;
  }

  throw new LocalWorkspaceFilesystemError(
    LOCAL_WORKSPACE_FILESYSTEM_ERROR_CODES.binaryFileNotReadable,
    `Workspace file appears to be binary and cannot be read as text: ${relativePath}`,
    { workspaceId },
  );
}

function readTextFileWithinLimits({
  absolutePath,
  relativePath,
  sizeBytes,
  startLine,
  maxLines,
  maxBytes,
}: {
  absolutePath: string;
  relativePath: string;
  sizeBytes: number;
  startLine: number;
  maxLines: number;
  maxBytes: number;
}): WorkspaceTextFileRead {
  const fd = openSync(absolutePath, "r");
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const chunkSize = Math.min(16_384, Math.max(1, maxBytes));
  const buffer = Buffer.alloc(chunkSize);
  const lines: string[] = [];
  let scannedBytes = 0;
  let returnedBytes = 0;
  let lineNumber = 1;
  let firstReturnedLine = 0;
  let lastReturnedLine = 0;
  let pending = "";
  let truncated = false;

  try {
    while (scannedBytes < maxBytes && lines.length < maxLines) {
      const remaining = maxBytes - scannedBytes;
      const bytesRead = readSync(fd, buffer, 0, Math.min(buffer.length, remaining), null);
      if (bytesRead === 0) {
        break;
      }

      scannedBytes += bytesRead;
      pending += decoder.decode(buffer.subarray(0, bytesRead), { stream: scannedBytes < maxBytes });
      const splitLines = pending.split("\n");
      pending = splitLines.pop() ?? "";

      for (const rawLine of splitLines) {
        const line = stripTrailingCarriageReturn(rawLine);
        if (lineNumber >= startLine && lines.length < maxLines) {
          const lineWithNewline = `${line}\n`;
          const nextBytes = Buffer.byteLength(lineWithNewline, "utf8");
          if (returnedBytes + nextBytes > maxBytes) {
            truncated = true;
            break;
          }

          if (firstReturnedLine === 0) {
            firstReturnedLine = lineNumber;
          }
          lines.push(lineWithNewline);
          returnedBytes += nextBytes;
          lastReturnedLine = lineNumber;
        }

        lineNumber += 1;
      }

      if (truncated) {
        break;
      }
    }

    if (!truncated && scannedBytes < maxBytes && pending.length > 0 && lines.length < maxLines) {
      if (lineNumber >= startLine) {
        const nextBytes = Buffer.byteLength(pending, "utf8");
        if (returnedBytes + nextBytes <= maxBytes) {
          if (firstReturnedLine === 0) {
            firstReturnedLine = lineNumber;
          }
          lines.push(pending);
          returnedBytes += nextBytes;
          lastReturnedLine = lineNumber;
        } else {
          truncated = true;
        }
      }
    }

    if (scannedBytes < sizeBytes || lines.length >= maxLines) {
      truncated = true;
    }

    return {
      path: relativePath,
      encoding: "utf8",
      binary: false,
      sizeBytes,
      startLine,
      endLine: lastReturnedLine,
      returnedLines: lines.length,
      returnedBytes,
      scannedBytes,
      truncated,
      content: lines.join(""),
    };
  } finally {
    closeSync(fd);
  }
}

function searchTextFile({
  absolutePath,
  relativePath,
  query,
  caseSensitive,
  remainingResults,
  maxLineTextBytes,
}: {
  absolutePath: string;
  relativePath: string;
  query: string;
  caseSensitive: boolean;
  remainingResults: number;
  maxLineTextBytes: number;
}): { matches: WorkspaceSearchMatch[]; truncated: boolean } {
  if (remainingResults <= 0) {
    return { matches: [], truncated: true };
  }

  const content = readFileSync(absolutePath, "utf8");
  const haystackQuery = caseSensitive ? query : query.toLocaleLowerCase();
  const matches: WorkspaceSearchMatch[] = [];
  const lines = content.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = stripTrailingCarriageReturn(lines[index] ?? "");
    const searchableLine = caseSensitive ? line : line.toLocaleLowerCase();
    const matchIndex = searchableLine.indexOf(haystackQuery);

    if (matchIndex === -1) {
      continue;
    }

    matches.push(toSearchMatch({
      path: relativePath,
      lineNumber: index + 1,
      line,
      matchStart: matchIndex,
      queryLength: query.length,
      maxLineTextBytes,
    }));

    if (matches.length >= remainingResults) {
      return { matches, truncated: index < lines.length - 1 };
    }
  }

  return { matches, truncated: false };
}

function toSearchMatch({
  path,
  lineNumber,
  line,
  matchStart,
  queryLength,
  maxLineTextBytes,
}: {
  path: string;
  lineNumber: number;
  line: string;
  matchStart: number;
  queryLength: number;
  maxLineTextBytes: number;
}): WorkspaceSearchMatch {
  const maxCharacters = Math.max(1, maxLineTextBytes);
  if (Buffer.byteLength(line, "utf8") <= maxLineTextBytes) {
    return {
      path,
      lineNumber,
      lineText: line,
      lineTruncated: false,
      matchStart,
      matchEnd: matchStart + queryLength,
    };
  }

  const matchEnd = matchStart + queryLength;
  const matchText = line.slice(matchStart, matchEnd);
  const matchBytes = Buffer.byteLength(matchText, "utf8");

  if (matchBytes >= maxCharacters) {
    const snippet = takeUtf8Prefix(matchText, maxCharacters);
    return {
      path,
      lineNumber,
      lineText: snippet,
      lineTruncated: true,
      matchStart: 0,
      matchEnd: snippet.length,
    };
  }

  const prefixBudget = Math.floor((maxCharacters - matchBytes) / 2);
  const prefix = takeUtf8Suffix(line.slice(0, matchStart), prefixBudget);
  const suffixBudget = Math.max(0, maxCharacters - Buffer.byteLength(prefix, "utf8") - matchBytes);
  const suffix = takeUtf8Prefix(line.slice(matchEnd), suffixBudget);
  const snippet = `${prefix}${matchText}${suffix}`;

  return {
    path,
    lineNumber,
    lineText: snippet,
    lineTruncated: true,
    matchStart: prefix.length,
    matchEnd: prefix.length + matchText.length,
  };
}

function takeUtf8Prefix(value: string, maxBytes: number): string {
  if (maxBytes <= 0) {
    return "";
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

function takeUtf8Suffix(value: string, maxBytes: number): string {
  if (maxBytes <= 0) {
    return "";
  }

  let bytes = 0;
  let startIndex = value.length;
  const characters = Array.from(value);
  for (let index = characters.length - 1; index >= 0; index -= 1) {
    const character = characters[index] ?? "";
    const nextBytes = Buffer.byteLength(character, "utf8");
    if (bytes + nextBytes > maxBytes) {
      break;
    }

    bytes += nextBytes;
    startIndex -= character.length;
  }

  return value.slice(startIndex);
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

function toFileTreeEntry(
  relativePath: string,
  stat: Stats,
  depth: number,
): WorkspaceFileTreeEntry {
  return {
    path: relativePath,
    type: toEntryType(stat),
    depth,
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  };
}

function toEntryType(stat: Stats): WorkspaceFileEntryType {
  if (stat.isFile()) {
    return "file";
  }

  if (stat.isDirectory()) {
    return "directory";
  }

  if (stat.isSymbolicLink()) {
    return "symlink";
  }

  return "other";
}

function toWorkspaceRelativePath(workspaceDirectory: string, absolutePath: string): string {
  const rawRelativePath = relative(workspaceDirectory, absolutePath).replaceAll(sep, "/");
  return rawRelativePath === "" ? "." : rawRelativePath;
}

function isWorkspaceRootPath(relativePath: string): boolean {
  return relativePath === "." || relativePath === "";
}

function pathMatchesDeniedPrefix(
  normalizedRelativePath: string,
  deniedPathPrefixes: readonly string[],
): boolean {
  return deniedPathPrefixes.some((rawPrefix) => {
    const prefix = rawPrefix.replace(/\/+$/, "");
    return normalizedRelativePath === prefix || normalizedRelativePath.startsWith(`${prefix}/`);
  });
}

function stripTrailingCarriageReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}
