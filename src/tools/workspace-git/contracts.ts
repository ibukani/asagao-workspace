import { z } from "zod";
import {
  createToolResponseSchema,
  toolFailureSchema,
  workspaceDiffDataSchema,
  workspaceGitStatusDataSchema,
  workspaceIdSchema,
} from "../../domain/index.ts";
import {
  WORKSPACE_GIT_DEFAULT_LIMITS,
  WORKSPACE_GIT_HARD_LIMITS,
} from "../../services/workspace-git-service.ts";

export const GET_GIT_STATUS_TOOL_NAME = "get_git_status";
export const GET_WORKSPACE_DIFF_TOOL_NAME = "get_workspace_diff";

export const WORKSPACE_GIT_TOOL_NAMES = [
  GET_GIT_STATUS_TOOL_NAME,
  GET_WORKSPACE_DIFF_TOOL_NAME,
] as const;

export const getGitStatusInputSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    maxFiles: z
      .number()
      .int()
      .positive()
      .max(WORKSPACE_GIT_HARD_LIMITS.maxFiles)
      .default(WORKSPACE_GIT_DEFAULT_LIMITS.maxFiles),
  })
  .strict();

export const getGitStatusOutputSchema = createToolResponseSchema(workspaceGitStatusDataSchema);

export const getWorkspaceDiffInputSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    includePatch: z.boolean().default(true),
    maxFiles: z
      .number()
      .int()
      .positive()
      .max(WORKSPACE_GIT_HARD_LIMITS.maxFiles)
      .default(WORKSPACE_GIT_DEFAULT_LIMITS.maxFiles),
    maxPatchBytes: z
      .number()
      .int()
      .positive()
      .max(WORKSPACE_GIT_HARD_LIMITS.maxPatchBytes)
      .default(WORKSPACE_GIT_DEFAULT_LIMITS.maxPatchBytes),
  })
  .strict();

export const getWorkspaceDiffOutputSchema = createToolResponseSchema(workspaceDiffDataSchema);

export const workspaceGitContracts = {
  [GET_GIT_STATUS_TOOL_NAME]: {
    name: GET_GIT_STATUS_TOOL_NAME,
    inputSchema: getGitStatusInputSchema,
    outputSchema: getGitStatusOutputSchema,
  },
  [GET_WORKSPACE_DIFF_TOOL_NAME]: {
    name: GET_WORKSPACE_DIFF_TOOL_NAME,
    inputSchema: getWorkspaceDiffInputSchema,
    outputSchema: getWorkspaceDiffOutputSchema,
  },
} as const;

export const workspaceGitFailureOutputSchema = toolFailureSchema;

export type GetGitStatusInput = z.infer<typeof getGitStatusInputSchema>;
export type GetWorkspaceDiffInput = z.infer<typeof getWorkspaceDiffInputSchema>;
