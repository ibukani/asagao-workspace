import type {
  WorkspaceFileTreeData,
  WorkspaceFileTreeEntry,
  WorkspaceSearchData,
} from "../../domain/index.ts";

export type WorkspaceTraversalListOptions = {
  workspaceId: string;
  workspaceDirectory: string;
  rootPath: string;
  maxDepth: number;
  maxEntries: number;
  includeFiles: boolean;
  deniedPathPrefixes?: readonly string[];
};

export type WorkspaceTraversalSearchOptions = {
  workspaceId: string;
  workspaceDirectory: string;
  rootPath: string;
  query: string;
  caseSensitive: boolean;
  maxResults: number;
  maxFileBytes: number;
  maxLineTextBytes: number;
  deniedPathPrefixes?: readonly string[];
};

export type WorkspaceTraversal = {
  listFileTree: (options: WorkspaceTraversalListOptions) => Promise<WorkspaceFileTreeData>;
  searchText: (options: WorkspaceTraversalSearchOptions) => Promise<WorkspaceSearchData>;
};

export type WorkspaceTraversalCandidate = WorkspaceFileTreeEntry & {
  absolutePath: string;
};
