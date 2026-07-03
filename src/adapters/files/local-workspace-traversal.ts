import { existsSync, lstatSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { TextDecoder } from "node:util";
import fastGlob from "fast-glob";
import type {
  WorkspaceFileEntryType,
  WorkspaceFileTreeData,
  WorkspaceFileTreeEntry,
  WorkspaceSearchData,
  WorkspaceSearchMatch,
} from "../../domain/index.ts";
import { WORKSPACE_PATH_ERROR_CODES, WorkspacePathBoundaryError } from "../../filesystem/workspace-paths.ts";
import { AdapterError, ADAPTER_ERROR_CODES } from "../errors.ts";
import { truncateUtf8 } from "../safe-metadata.ts";
import { isBinaryFile } from "./binary-detector.ts";
import { createWorkspaceIgnoreFilter } from "./workspace-ignore-filter.ts";
import type {
  WorkspaceTraversal,
  WorkspaceTraversalCandidate,
  WorkspaceTraversalListOptions,
  WorkspaceTraversalSearchOptions,
} from "./workspace-traversal.ts";

export class LocalWorkspaceTraversal implements WorkspaceTraversal {
  async listFileTree({
    workspaceId,
    workspaceDirectory,
    rootPath,
    maxDepth,
    maxEntries,
    includeFiles,
    deniedPathPrefixes = [],
  }: WorkspaceTraversalListOptions): Promise<WorkspaceFileTreeData> {
    try {
      const rootAbsolutePath = resolveTraversalRoot(workspaceDirectory, rootPath);
      assertDirectory(rootAbsolutePath, workspaceId, rootPath);
      const rootRelativePath = toWorkspaceRelativePath(workspaceDirectory, rootAbsolutePath);
      const ignoreFilter = createWorkspaceIgnoreFilter(workspaceDirectory);
      const deniedTracker = new PrefixSkipTracker(deniedPathPrefixes);
      const ignoredTracker = new IgnoredSkipTracker(ignoreFilter.ignores.bind(ignoreFilter));
      const depthTracker = new SubtreeSkipTracker();
      const candidates = await collectTraversalCandidates({ workspaceDirectory, rootAbsolutePath, rootRelativePath });
      const entries: WorkspaceFileTreeEntry[] = [];
      let omittedCount = 0;
      let truncated = false;

      for (const candidate of candidates) {
        if (deniedTracker.shouldSkip(candidate.path, candidate.type === "directory")) {
          if (deniedTracker.wasNewlySkipped(candidate.path)) {
            omittedCount += 1;
          }
          continue;
        }

        if (ignoredTracker.shouldSkip(candidate.path, candidate.type === "directory")) {
          if (ignoredTracker.wasNewlySkipped(candidate.path)) {
            omittedCount += 1;
          }
          continue;
        }

        if (candidate.depth > maxDepth) {
          if (!depthTracker.shouldSkip(candidate.path, candidate.type === "directory")) {
            omittedCount += 1;
          }
          truncated = true;
          continue;
        }

        if (!includeFiles && candidate.type === "file") {
          continue;
        }

        if (entries.length >= maxEntries) {
          omittedCount += 1;
          truncated = true;
          continue;
        }

        entries.push(toPublicEntry(candidate));
      }

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
      if (error instanceof WorkspacePathBoundaryError || error instanceof AdapterError) {
        throw error;
      }

      throw new AdapterError({
        operation: "workspace_traversal.list_file_tree",
        code: ADAPTER_ERROR_CODES.traversalFailed,
        message: "Workspace file traversal failed.",
        details: { workspaceId, rootPath, message: error instanceof Error ? error.message : String(error) },
        cause: error,
      });
    }
  }

  async searchText({
    workspaceId,
    workspaceDirectory,
    rootPath,
    query,
    caseSensitive,
    maxResults,
    maxFileBytes,
    maxLineTextBytes,
    deniedPathPrefixes = [],
  }: WorkspaceTraversalSearchOptions): Promise<WorkspaceSearchData> {
    try {
      const rootAbsolutePath = resolveTraversalRoot(workspaceDirectory, rootPath);
      assertDirectory(rootAbsolutePath, workspaceId, rootPath);
      const rootRelativePath = toWorkspaceRelativePath(workspaceDirectory, rootAbsolutePath);
      const ignoreFilter = createWorkspaceIgnoreFilter(workspaceDirectory);
      const deniedTracker = new PrefixSkipTracker(deniedPathPrefixes);
      const ignoredTracker = new IgnoredSkipTracker(ignoreFilter.ignores.bind(ignoreFilter));
      const candidates = await collectTraversalCandidates({ workspaceDirectory, rootAbsolutePath, rootRelativePath });
      const matches: WorkspaceSearchMatch[] = [];
      const skippedFiles = {
        binary: 0,
        tooLarge: 0,
        denied: 0,
        ignored: 0,
        unreadable: 0,
      };
      let searchedFiles = 0;
      let truncated = false;

      for (const candidate of candidates) {
        if (truncated) {
          break;
        }

        if (deniedTracker.shouldSkip(candidate.path, candidate.type === "directory")) {
          if (deniedTracker.wasNewlySkipped(candidate.path)) {
            skippedFiles.denied += 1;
          }
          continue;
        }

        if (ignoredTracker.shouldSkip(candidate.path, candidate.type === "directory")) {
          if (ignoredTracker.wasNewlySkipped(candidate.path)) {
            skippedFiles.ignored += 1;
          }
          continue;
        }

        if (candidate.type === "directory") {
          continue;
        }

        if (candidate.type !== "file") {
          skippedFiles.unreadable += 1;
          continue;
        }

        if ((candidate.sizeBytes ?? 0) > maxFileBytes) {
          skippedFiles.tooLarge += 1;
          continue;
        }

        if (isBinaryFile(candidate.absolutePath)) {
          skippedFiles.binary += 1;
          continue;
        }

        try {
          const fileMatches = searchTextFile({
            absolutePath: candidate.absolutePath,
            relativePath: candidate.path,
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
      if (error instanceof WorkspacePathBoundaryError || error instanceof AdapterError) {
        throw error;
      }

      throw new AdapterError({
        operation: "workspace_traversal.search_text",
        code: ADAPTER_ERROR_CODES.traversalFailed,
        message: "Workspace text search failed.",
        details: { workspaceId, rootPath, message: error instanceof Error ? error.message : String(error) },
        cause: error,
      });
    }
  }
}

async function collectTraversalCandidates({
  workspaceDirectory,
  rootAbsolutePath,
  rootRelativePath,
}: {
  workspaceDirectory: string;
  rootAbsolutePath: string;
  rootRelativePath: string;
}): Promise<WorkspaceTraversalCandidate[]> {
  const entries = await fastGlob("**/*", {
    cwd: rootAbsolutePath,
    dot: true,
    onlyFiles: false,
    followSymbolicLinks: false,
    unique: true,
    objectMode: true,
    stats: true,
  });

  return entries
    .map((entry) => {
      const relativeToRoot = entry.path.replaceAll("\\", "/");
      const path = rootRelativePath === "." ? relativeToRoot : `${rootRelativePath}/${relativeToRoot}`;
      const absolutePath = resolve(rootAbsolutePath, relativeToRoot);
      const stat = lstatSync(absolutePath);
      return {
        path,
        absolutePath,
        type: toEntryType(stat),
        depth: pathDepth(relativeToRoot),
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      } satisfies WorkspaceTraversalCandidate;
    })
    .filter((entry) => isInsideBoundary(workspaceDirectory, entry.absolutePath))
    .sort((left, right) => compareWorkspacePaths(left.path, right.path));
}

function resolveTraversalRoot(workspaceDirectory: string, rootPath: string): string {
  const rootAbsolutePath = rootPath === "." || rootPath === ""
    ? workspaceDirectory
    : resolve(workspaceDirectory, rootPath);

  if (!isInsideBoundary(workspaceDirectory, rootAbsolutePath)) {
    throw new WorkspacePathBoundaryError(
      WORKSPACE_PATH_ERROR_CODES.pathOutsideWorkspace,
      `Workspace traversal root escapes workspace: ${rootPath}`,
    );
  }

  return rootAbsolutePath;
}

function assertDirectory(absolutePath: string, workspaceId: string, relativePath: string): void {
  if (!existsSync(absolutePath)) {
    throw new AdapterError({
      operation: "workspace_traversal.assert_directory",
      code: ADAPTER_ERROR_CODES.traversalFailed,
      message: "Workspace traversal root was not found.",
      details: { workspaceId, relativePath, reason: "path_not_found" },
    });
  }

  const stat = lstatSync(absolutePath);
  if (!stat.isDirectory()) {
    throw new AdapterError({
      operation: "workspace_traversal.assert_directory",
      code: ADAPTER_ERROR_CODES.traversalFailed,
      message: "Workspace traversal root is not a directory.",
      details: { workspaceId, relativePath, reason: "not_directory" },
    });
  }
}

function toEntryType(stat: { isFile: () => boolean; isDirectory: () => boolean; isSymbolicLink: () => boolean }): WorkspaceFileEntryType {
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

function toPublicEntry(candidate: WorkspaceTraversalCandidate): WorkspaceFileTreeEntry {
  return {
    path: candidate.path,
    type: candidate.type,
    depth: candidate.depth,
    sizeBytes: candidate.sizeBytes,
    modifiedAt: candidate.modifiedAt,
  };
}

function pathDepth(relativeToRoot: string): number {
  return relativeToRoot.split("/").filter((part) => part.length > 0).length;
}

function isInsideBoundary(boundary: string, candidate: string): boolean {
  const relativePath = relative(boundary, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !relativePath.startsWith(sep));
}

function toWorkspaceRelativePath(workspaceDirectory: string, absolutePath: string): string {
  const rawRelativePath = relative(workspaceDirectory, absolutePath).replaceAll(sep, "/");
  return rawRelativePath === "" ? "." : rawRelativePath;
}

class PrefixSkipTracker {
  readonly #prefixes: string[];
  readonly #skippedPrefixes = new Set<string>();
  #newlySkippedPath: string | null = null;

  constructor(prefixes: readonly string[]) {
    this.#prefixes = prefixes.map((prefix) => prefix.replace(/\/+$/, ""));
  }

  shouldSkip(path: string, isDirectory: boolean): boolean {
    this.#newlySkippedPath = null;
    const matchingPrefix = this.#prefixes.find((prefix) => path === prefix || path.startsWith(`${prefix}/`));
    if (matchingPrefix === undefined) {
      return false;
    }

    const alreadySkipped = [...this.#skippedPrefixes].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
    if (!alreadySkipped) {
      this.#newlySkippedPath = path;
    }

    if (isDirectory) {
      this.#skippedPrefixes.add(path);
    }

    return true;
  }

  wasNewlySkipped(path: string): boolean {
    return this.#newlySkippedPath === path;
  }
}

class IgnoredSkipTracker {
  readonly #ignores: (path: string) => boolean;
  readonly #skippedDirectories = new Set<string>();
  #newlySkippedPath: string | null = null;

  constructor(ignores: (path: string) => boolean) {
    this.#ignores = ignores;
  }

  shouldSkip(path: string, isDirectory: boolean): boolean {
    this.#newlySkippedPath = null;
    const alreadySkipped = [...this.#skippedDirectories].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
    if (alreadySkipped) {
      return true;
    }

    if (!this.#ignores(path)) {
      return false;
    }

    this.#newlySkippedPath = path;
    if (isDirectory) {
      this.#skippedDirectories.add(path);
    }

    return true;
  }

  wasNewlySkipped(path: string): boolean {
    return this.#newlySkippedPath === path;
  }
}

class SubtreeSkipTracker {
  readonly #skippedDirectories = new Set<string>();

  shouldSkip(path: string, isDirectory: boolean): boolean {
    const alreadySkipped = [...this.#skippedDirectories].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
    if (alreadySkipped) {
      return true;
    }

    if (isDirectory) {
      this.#skippedDirectories.add(path);
    }

    return false;
  }
}

function compareWorkspacePaths(left: string, right: string): number {
  const leftParts = left.split("/");
  const rightParts = right.split("/");
  const length = Math.min(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const comparison = (leftParts[index] ?? "").localeCompare(rightParts[index] ?? "");
    if (comparison !== 0) {
      return comparison;
    }
  }

  return leftParts.length - rightParts.length;
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

  const content = decodeUtf8(readFileSync(absolutePath));
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

function decodeUtf8(content: Buffer): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(content);
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

  if (matchBytes >= maxLineTextBytes) {
    const snippet = truncateUtf8(matchText, maxLineTextBytes).content;
    return {
      path,
      lineNumber,
      lineText: snippet,
      lineTruncated: true,
      matchStart: 0,
      matchEnd: snippet.length,
    };
  }

  const prefixBudget = Math.floor((maxLineTextBytes - matchBytes) / 2);
  const prefix = takeUtf8Suffix(line.slice(0, matchStart), prefixBudget);
  const suffixBudget = Math.max(0, maxLineTextBytes - Buffer.byteLength(prefix, "utf8") - matchBytes);
  const suffix = truncateUtf8(line.slice(matchEnd), suffixBudget).content;
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

function stripTrailingCarriageReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}
