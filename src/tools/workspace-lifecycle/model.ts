import { z, type ZodType } from "zod";
import {
  toolError,
  toolSuccess,
  type ToolFailure,
  type ToolResponse,
} from "../../domain/index.ts";
import type { WorkspaceRegistry } from "../../services/workspace-registry.ts";
import {
  createWorkspaceInputSchema,
  type CreateWorkspaceInput,
  deleteWorkspaceInputSchema,
  type DeleteWorkspaceInput,
  getWorkspaceInputSchema,
  type GetWorkspaceInput,
  listWorkspacesInputSchema,
  type ListWorkspacesInput,
} from "./contracts.ts";

export const WORKSPACE_LIFECYCLE_ERROR_CODES = {
  invalidInput: "invalid_input",
  workspaceNotFound: "workspace_not_found",
  registryUnavailable: "registry_unavailable",
} as const;

export type CreateWorkspaceResult = ToolResponse<{
  workspace: ReturnType<WorkspaceRegistry["createWorkspace"]>;
}>;

export type ListWorkspacesResult = ToolResponse<{
  workspaces: ReturnType<WorkspaceRegistry["listWorkspaces"]>;
}>;

export type GetWorkspaceResult = ToolResponse<{
  workspace: NonNullable<ReturnType<WorkspaceRegistry["getWorkspace"]>>;
}>;

export type DeleteWorkspaceResult = ToolResponse<{
  workspaceId: string;
  deleted: true;
}>;

export function buildCreateWorkspaceResult(
  registry: WorkspaceRegistry,
  input: unknown,
): CreateWorkspaceResult {
  const parsed = parseLifecycleInput(createWorkspaceInputSchema, input);
  if (!parsed.ok) {
    return parsed;
  }

  return withRegistryErrorHandling(() => {
    const workspace = registry.createWorkspace(parsed.data);
    return toolSuccess({ workspace });
  });
}

export function buildListWorkspacesResult(
  registry: WorkspaceRegistry,
  input: unknown,
): ListWorkspacesResult {
  const parsed = parseLifecycleInput(listWorkspacesInputSchema, input ?? {});
  if (!parsed.ok) {
    return parsed;
  }

  return withRegistryErrorHandling(() => {
    const workspaces = registry.listWorkspaces(parsed.data);
    return toolSuccess({ workspaces });
  });
}

export function buildGetWorkspaceResult(
  registry: WorkspaceRegistry,
  input: unknown,
): GetWorkspaceResult {
  const parsed = parseLifecycleInput(getWorkspaceInputSchema, input);
  if (!parsed.ok) {
    return parsed;
  }

  return withRegistryErrorHandling(() => {
    const workspace = registry.getWorkspace(parsed.data.workspaceId);
    if (workspace === null) {
      return workspaceNotFound(parsed.data.workspaceId);
    }

    return toolSuccess({ workspace });
  });
}

export function buildDeleteWorkspaceResult(
  registry: WorkspaceRegistry,
  input: unknown,
): DeleteWorkspaceResult {
  const parsed = parseLifecycleInput(deleteWorkspaceInputSchema, input);
  if (!parsed.ok) {
    return parsed;
  }

  return withRegistryErrorHandling(() => {
    const workspace = registry.deleteWorkspace(parsed.data.workspaceId);
    if (workspace === null) {
      return workspaceNotFound(parsed.data.workspaceId);
    }

    return toolSuccess({
      workspaceId: workspace.workspaceId,
      deleted: true,
    });
  });
}

function parseLifecycleInput<Input>(
  schema: ZodType<Input>,
  input: unknown,
): ToolResponse<Input> {
  const parsed = schema.safeParse(input);

  if (parsed.success) {
    return toolSuccess(parsed.data);
  }

  return toolError(
    WORKSPACE_LIFECYCLE_ERROR_CODES.invalidInput,
    "Invalid workspace lifecycle request.",
    { issues: z.treeifyError(parsed.error) },
  );
}

function workspaceNotFound(workspaceId: string): ToolFailure {
  return toolError(
    WORKSPACE_LIFECYCLE_ERROR_CODES.workspaceNotFound,
    "Workspace not found.",
    { workspaceId },
  );
}

function withRegistryErrorHandling<Data>(operation: () => ToolResponse<Data>): ToolResponse<Data> {
  try {
    return operation();
  } catch (error) {
    return toolError(
      WORKSPACE_LIFECYCLE_ERROR_CODES.registryUnavailable,
      "Workspace registry operation failed.",
      { message: error instanceof Error ? error.message : String(error) },
    );
  }
}

export type {
  CreateWorkspaceInput,
  DeleteWorkspaceInput,
  GetWorkspaceInput,
  ListWorkspacesInput,
};
