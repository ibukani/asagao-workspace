import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import {
  CREATE_WORKSPACE_TOOL_NAME,
  DELETE_WORKSPACE_TOOL_NAME,
  GET_WORKSPACE_TOOL_NAME,
  LIST_WORKSPACES_TOOL_NAME,
  commonToolErrorSchema,
  createWorkspaceInputSchema,
  deleteWorkspaceInputSchema,
  getWorkspaceInputSchema,
  listWorkspacesInputSchema,
  workspaceSchema,
} from "./contracts.js";
import {
  buildCreateWorkspaceResult,
  buildDeleteWorkspaceResult,
  buildGetWorkspaceResult,
  buildListWorkspacesResult,
} from "./model.js";

export function registerWorkspaceLifecycleTools(server, { config, workspaceRegistry }) {
  if (!workspaceRegistry) {
    throw new Error("workspaceRegistry is required to register workspace lifecycle tools");
  }

  registerAppTool(
    server,
    CREATE_WORKSPACE_TOOL_NAME,
    {
      title: "Create workspace",
      description:
        "Creates an in-memory Workspace record. This does not create directories, clone repositories, apply patches, or run commands yet.",
      inputSchema: createWorkspaceInputSchema.shape,
      outputSchema: workspaceEnvelopeSchema({ workspace: workspaceSchema }),
      annotations: { readOnlyHint: false },
      _meta: {
        ui: { resourceUri: config.ui.widgetUri },
      },
    },
    async (input) => toAppToolResponse(buildCreateWorkspaceResult(workspaceRegistry, input)),
  );

  registerAppTool(
    server,
    LIST_WORKSPACES_TOOL_NAME,
    {
      title: "List workspaces",
      description:
        "Lists in-memory Workspace records. Deleted workspaces are hidden unless includeDeleted is true.",
      inputSchema: listWorkspacesInputSchema.shape,
      outputSchema: workspaceEnvelopeSchema({ workspaces: z.array(workspaceSchema) }),
      annotations: { readOnlyHint: true },
      _meta: {
        ui: { resourceUri: config.ui.widgetUri },
      },
    },
    async (input) => toAppToolResponse(buildListWorkspacesResult(workspaceRegistry, input)),
  );

  registerAppTool(
    server,
    GET_WORKSPACE_TOOL_NAME,
    {
      title: "Get workspace",
      description:
        "Returns one in-memory Workspace record by workspaceId, including deleted status when present.",
      inputSchema: getWorkspaceInputSchema.shape,
      outputSchema: workspaceEnvelopeSchema({ workspace: workspaceSchema }),
      annotations: { readOnlyHint: true },
      _meta: {
        ui: { resourceUri: config.ui.widgetUri },
      },
    },
    async (input) => toAppToolResponse(buildGetWorkspaceResult(workspaceRegistry, input)),
  );

  registerAppTool(
    server,
    DELETE_WORKSPACE_TOOL_NAME,
    {
      title: "Delete workspace",
      description:
        "Marks an in-memory Workspace as deleted. This does not delete filesystem data because filesystem workspaces are not implemented yet.",
      inputSchema: deleteWorkspaceInputSchema.shape,
      outputSchema: workspaceEnvelopeSchema({ workspace: workspaceSchema }),
      annotations: { readOnlyHint: false },
      _meta: {
        ui: { resourceUri: config.ui.widgetUri },
      },
    },
    async (input) => toAppToolResponse(buildDeleteWorkspaceResult(workspaceRegistry, input)),
  );
}

function workspaceEnvelopeSchema(resultShape) {
  return {
    ok: z.boolean(),
    result: z.object(resultShape).nullable(),
    error: commonToolErrorSchema.nullable(),
    message: z.string().nullable(),
    warnings: z.array(z.string()),
  };
}

function toAppToolResponse(structuredContent) {
  return {
    structuredContent,
    content: [
      {
        type: "text",
        text: structuredContent.ok
          ? structuredContent.message ?? "Workspace lifecycle request completed."
          : structuredContent.error.message,
      },
    ],
  };
}
