import { z } from "zod";
import {
  INTERNET_POLICIES,
  RUNTIME_PROFILES,
  WORKSPACE_STATUSES,
} from "../../domain/workspace.js";

export const CREATE_WORKSPACE_TOOL_NAME = "create_workspace";
export const LIST_WORKSPACES_TOOL_NAME = "list_workspaces";
export const GET_WORKSPACE_TOOL_NAME = "get_workspace";
export const DELETE_WORKSPACE_TOOL_NAME = "delete_workspace";

export const WORKSPACE_LIFECYCLE_TOOL_NAMES = Object.freeze([
  CREATE_WORKSPACE_TOOL_NAME,
  LIST_WORKSPACES_TOOL_NAME,
  GET_WORKSPACE_TOOL_NAME,
  DELETE_WORKSPACE_TOOL_NAME,
]);

export const MAX_WORKSPACE_TTL_MINUTES = 7 * 24 * 60;

const nullableStringSchema = z.string().nullable();
const isoTimestampSchema = z.string().datetime({ offset: true }).nullable();

export const workspaceSourceSchema = z.record(z.string(), z.unknown()).nullable();

export const workspaceSchema = z.object({
  workspaceId: z.string().min(1),
  workspaceName: nullableStringSchema,
  status: z.enum(WORKSPACE_STATUSES),
  source: workspaceSourceSchema,
  baseCommit: nullableStringSchema,
  currentCommit: nullableStringSchema,
  defaultBranch: nullableStringSchema,
  workingBranch: nullableStringSchema,
  runtimeProfile: z.enum(RUNTIME_PROFILES),
  internetPolicy: z.enum(INTERNET_POLICIES),
  createdAt: z.string().datetime({ offset: true }),
  expiresAt: isoTimestampSchema,
  deletedAt: isoTimestampSchema,
  failureReason: nullableStringSchema,
});

export const commonToolErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.unknown().nullable(),
  retryable: z.boolean(),
});

export function toolSuccessSchema(resultSchema) {
  return z.object({
    ok: z.literal(true),
    result: resultSchema,
    error: z.null(),
    message: nullableStringSchema,
    warnings: z.array(z.string()),
  });
}

export function toolResponseSchema(resultSchema) {
  return z.union([
    toolSuccessSchema(resultSchema),
    z.object({
      ok: z.literal(false),
      result: z.null(),
      error: commonToolErrorSchema,
      message: z.null(),
      warnings: z.array(z.string()),
    }),
  ]);
}

export const createWorkspaceInputSchema = z.object({
  repoUrl: z.string().url().optional(),
  branch: z.string().min(1).max(200).optional(),
  baseRef: z.string().min(1).max(200).optional(),
  workspaceName: z.string().min(1).max(120).optional(),
  runtimeProfile: z.enum(RUNTIME_PROFILES).optional(),
  internetPolicy: z.enum(INTERNET_POLICIES).optional(),
  ttlMinutes: z.number().int().positive().max(MAX_WORKSPACE_TTL_MINUTES).optional(),
});

export const listWorkspacesInputSchema = z.object({
  includeDeleted: z.boolean().optional(),
});

export const getWorkspaceInputSchema = z.object({
  workspaceId: z.string().min(1),
});

export const deleteWorkspaceInputSchema = z.object({
  workspaceId: z.string().min(1),
});

export const createWorkspaceOutputSchema = toolResponseSchema(z.object({
  workspace: workspaceSchema,
}));

export const listWorkspacesOutputSchema = toolResponseSchema(z.object({
  workspaces: z.array(workspaceSchema),
}));

export const getWorkspaceOutputSchema = toolResponseSchema(z.object({
  workspace: workspaceSchema,
}));

export const deleteWorkspaceOutputSchema = toolResponseSchema(z.object({
  workspace: workspaceSchema,
}));
