import {
  COMMON_ERROR_CODES,
  createToolError,
  createToolSuccess,
} from "../../domain/tool-result.js";
import {
  createWorkspaceInputSchema,
  deleteWorkspaceInputSchema,
  getWorkspaceInputSchema,
  listWorkspacesInputSchema,
} from "./contracts.js";

export function buildCreateWorkspaceResult(registry, input) {
  return withInvalidInputHandling(() => {
    const parsedInput = createWorkspaceInputSchema.parse(input);
    const workspace = registry.createWorkspace(parsedInput);

    return createToolSuccess({
      result: { workspace },
      message: "Workspace created.",
    });
  });
}

export function buildListWorkspacesResult(registry, input) {
  return withInvalidInputHandling(() => {
    const parsedInput = listWorkspacesInputSchema.parse(input ?? {});
    const workspaces = registry.listWorkspaces(parsedInput);

    return createToolSuccess({
      result: { workspaces },
    });
  });
}

export function buildGetWorkspaceResult(registry, input) {
  return withInvalidInputHandling(() => {
    const parsedInput = getWorkspaceInputSchema.parse(input);
    const workspace = registry.getWorkspace(parsedInput.workspaceId);

    if (!workspace) {
      return createWorkspaceNotFoundError(parsedInput.workspaceId);
    }

    return createToolSuccess({
      result: { workspace },
    });
  });
}

export function buildDeleteWorkspaceResult(registry, input) {
  return withInvalidInputHandling(() => {
    const parsedInput = deleteWorkspaceInputSchema.parse(input);
    const workspace = registry.deleteWorkspace(parsedInput.workspaceId);

    if (!workspace) {
      return createWorkspaceNotFoundError(parsedInput.workspaceId);
    }

    return createToolSuccess({
      result: { workspace },
      message: "Workspace marked as deleted.",
    });
  });
}

function createWorkspaceNotFoundError(workspaceId) {
  return createToolError({
    code: COMMON_ERROR_CODES.NOT_FOUND,
    message: "Workspace not found.",
    details: { workspaceId },
  });
}

function withInvalidInputHandling(operation) {
  try {
    return operation();
  } catch (error) {
    return createToolError({
      code: COMMON_ERROR_CODES.INVALID_INPUT,
      message: "Invalid workspace lifecycle request.",
      details: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}
