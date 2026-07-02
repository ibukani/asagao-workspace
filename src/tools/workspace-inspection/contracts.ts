import { z } from "zod";
import {
  createToolResponseSchema,
  toolFailureSchema,
  workspaceFileTreeDataSchema,
  workspaceIdSchema,
  workspaceReadFileDataSchema,
  workspaceSearchDataSchema,
} from "../../domain/index.ts";
import {
  WORKSPACE_INSPECTION_DEFAULT_LIMITS,
  WORKSPACE_INSPECTION_HARD_LIMITS,
} from "../../services/workspace-inspection-service.ts";

export const GET_FILE_TREE_TOOL_NAME = "get_file_tree";
export const READ_FILE_TOOL_NAME = "read_file";
export const SEARCH_WORKSPACE_TOOL_NAME = "search_workspace";

export const WORKSPACE_INSPECTION_TOOL_NAMES = [
  GET_FILE_TREE_TOOL_NAME,
  READ_FILE_TOOL_NAME,
  SEARCH_WORKSPACE_TOOL_NAME,
] as const;

const workspaceInspectionPathInputSchema = z.string().min(1).max(1_000);

export const getFileTreeInputSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    rootPath: workspaceInspectionPathInputSchema.default("."),
    maxDepth: z
      .number()
      .int()
      .nonnegative()
      .max(WORKSPACE_INSPECTION_HARD_LIMITS.fileTreeMaxDepth)
      .default(WORKSPACE_INSPECTION_DEFAULT_LIMITS.fileTreeMaxDepth),
    maxEntries: z
      .number()
      .int()
      .positive()
      .max(WORKSPACE_INSPECTION_HARD_LIMITS.fileTreeMaxEntries)
      .default(WORKSPACE_INSPECTION_DEFAULT_LIMITS.fileTreeMaxEntries),
    includeFiles: z.boolean().default(true),
  })
  .strict();

export const getFileTreeOutputSchema = createToolResponseSchema(workspaceFileTreeDataSchema);

export const readFileInputSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    path: workspaceInspectionPathInputSchema,
    startLine: z.number().int().positive().default(1),
    maxLines: z
      .number()
      .int()
      .positive()
      .max(WORKSPACE_INSPECTION_HARD_LIMITS.readMaxLines)
      .default(WORKSPACE_INSPECTION_DEFAULT_LIMITS.readMaxLines),
    maxBytes: z
      .number()
      .int()
      .positive()
      .max(WORKSPACE_INSPECTION_HARD_LIMITS.readMaxBytes)
      .default(WORKSPACE_INSPECTION_DEFAULT_LIMITS.readMaxBytes),
  })
  .strict();

export const readFileOutputSchema = createToolResponseSchema(workspaceReadFileDataSchema);

export const searchWorkspaceInputSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    query: z.string().min(1).max(1_000),
    rootPath: workspaceInspectionPathInputSchema.default("."),
    caseSensitive: z.boolean().default(false),
    maxResults: z
      .number()
      .int()
      .positive()
      .max(WORKSPACE_INSPECTION_HARD_LIMITS.searchMaxResults)
      .default(WORKSPACE_INSPECTION_DEFAULT_LIMITS.searchMaxResults),
    maxFileBytes: z
      .number()
      .int()
      .positive()
      .max(WORKSPACE_INSPECTION_HARD_LIMITS.searchMaxFileBytes)
      .default(WORKSPACE_INSPECTION_DEFAULT_LIMITS.searchMaxFileBytes),
  })
  .strict();

export const searchWorkspaceOutputSchema = createToolResponseSchema(workspaceSearchDataSchema);

export const workspaceInspectionContracts = {
  [GET_FILE_TREE_TOOL_NAME]: {
    name: GET_FILE_TREE_TOOL_NAME,
    inputSchema: getFileTreeInputSchema,
    outputSchema: getFileTreeOutputSchema,
  },
  [READ_FILE_TOOL_NAME]: {
    name: READ_FILE_TOOL_NAME,
    inputSchema: readFileInputSchema,
    outputSchema: readFileOutputSchema,
  },
  [SEARCH_WORKSPACE_TOOL_NAME]: {
    name: SEARCH_WORKSPACE_TOOL_NAME,
    inputSchema: searchWorkspaceInputSchema,
    outputSchema: searchWorkspaceOutputSchema,
  },
} as const;

export const workspaceInspectionFailureOutputSchema = toolFailureSchema;

export type GetFileTreeInput = z.infer<typeof getFileTreeInputSchema>;
export type ReadFileInput = z.infer<typeof readFileInputSchema>;
export type SearchWorkspaceInput = z.infer<typeof searchWorkspaceInputSchema>;
