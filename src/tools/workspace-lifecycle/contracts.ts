import { z } from "zod";
import {
  createToolResponseSchema,
  internetPolicySchema,
  runtimeProfileSchema,
  toolFailureSchema,
  workspaceIdSchema,
  workspaceSchema,
  workspaceStatusSchema,
} from "../../domain/index.ts";

export const CREATE_WORKSPACE_TOOL_NAME = "create_workspace";
export const LIST_WORKSPACES_TOOL_NAME = "list_workspaces";
export const GET_WORKSPACE_TOOL_NAME = "get_workspace";
export const DELETE_WORKSPACE_TOOL_NAME = "delete_workspace";

export const WORKSPACE_LIFECYCLE_TOOL_NAMES = [
  CREATE_WORKSPACE_TOOL_NAME,
  LIST_WORKSPACES_TOOL_NAME,
  GET_WORKSPACE_TOOL_NAME,
  DELETE_WORKSPACE_TOOL_NAME,
] as const;

export const createWorkspaceInputSchema = z
  .object({
    repoUrl: z.string().url().optional(),
    branch: z.string().min(1).optional(),
    baseRef: z.string().min(1).optional(),
    workspaceName: z.string().min(1).max(120).optional(),
    runtimeProfile: runtimeProfileSchema.optional(),
    internetPolicy: internetPolicySchema.optional(),
    ttlMinutes: z.number().int().positive().max(24 * 60).optional(),
  })
  .strict();

export const createWorkspaceDataSchema = z
  .object({
    workspace: workspaceSchema,
  })
  .strict();

export const createWorkspaceOutputSchema = createToolResponseSchema(createWorkspaceDataSchema);

export const listWorkspacesInputSchema = z
  .object({
    status: z.array(workspaceStatusSchema).min(1).optional(),
    runtimeProfile: z.array(runtimeProfileSchema).min(1).optional(),
  })
  .strict();

export const listWorkspacesDataSchema = z
  .object({
    workspaces: z.array(workspaceSchema),
  })
  .strict();

export const listWorkspacesOutputSchema = createToolResponseSchema(listWorkspacesDataSchema);

export const getWorkspaceInputSchema = z
  .object({
    workspaceId: workspaceIdSchema,
  })
  .strict();

export const getWorkspaceDataSchema = z
  .object({
    workspace: workspaceSchema,
  })
  .strict();

export const getWorkspaceOutputSchema = createToolResponseSchema(getWorkspaceDataSchema);

export const deleteWorkspaceInputSchema = z
  .object({
    workspaceId: workspaceIdSchema,
  })
  .strict();

export const deleteWorkspaceDataSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    deleted: z.literal(true),
  })
  .strict();

export const deleteWorkspaceOutputSchema = createToolResponseSchema(deleteWorkspaceDataSchema);

export const workspaceLifecycleContracts = {
  [CREATE_WORKSPACE_TOOL_NAME]: {
    name: CREATE_WORKSPACE_TOOL_NAME,
    inputSchema: createWorkspaceInputSchema,
    outputSchema: createWorkspaceOutputSchema,
  },
  [LIST_WORKSPACES_TOOL_NAME]: {
    name: LIST_WORKSPACES_TOOL_NAME,
    inputSchema: listWorkspacesInputSchema,
    outputSchema: listWorkspacesOutputSchema,
  },
  [GET_WORKSPACE_TOOL_NAME]: {
    name: GET_WORKSPACE_TOOL_NAME,
    inputSchema: getWorkspaceInputSchema,
    outputSchema: getWorkspaceOutputSchema,
  },
  [DELETE_WORKSPACE_TOOL_NAME]: {
    name: DELETE_WORKSPACE_TOOL_NAME,
    inputSchema: deleteWorkspaceInputSchema,
    outputSchema: deleteWorkspaceOutputSchema,
  },
} as const;

export const workspaceLifecycleFailureOutputSchema = toolFailureSchema;

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInputSchema>;
export type ListWorkspacesInput = z.infer<typeof listWorkspacesInputSchema>;
export type GetWorkspaceInput = z.infer<typeof getWorkspaceInputSchema>;
export type DeleteWorkspaceInput = z.infer<typeof deleteWorkspaceInputSchema>;
