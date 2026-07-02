import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "../../config/env.ts";
import type { ToolResponse } from "../../domain/index.ts";
import type { WorkspaceLifecycleService } from "../../services/workspace-lifecycle-service.ts";
import type { WorkspaceRegistry } from "../../services/workspace-registry.ts";
import {
  CREATE_WORKSPACE_TOOL_NAME,
  DELETE_WORKSPACE_TOOL_NAME,
  GET_WORKSPACE_TOOL_NAME,
  GET_WORKSPACE_LIFECYCLE_TOOL_NAME,
  LIST_WORKSPACES_TOOL_NAME,
  createWorkspaceInputSchema,
  createWorkspaceOutputSchema,
  deleteWorkspaceInputSchema,
  deleteWorkspaceOutputSchema,
  getWorkspaceInputSchema,
  getWorkspaceLifecycleInputSchema,
  getWorkspaceLifecycleOutputSchema,
  getWorkspaceOutputSchema,
  listWorkspacesInputSchema,
  listWorkspacesOutputSchema,
} from "./contracts.ts";
import {
  buildCreateWorkspaceResult,
  buildDeleteWorkspaceResult,
  buildGetWorkspaceResult,
  buildGetWorkspaceLifecycleResult,
  buildListWorkspacesResult,
} from "./model.ts";

export type RegisterWorkspaceLifecycleToolsOptions = {
  config: AppConfig;
  workspaceRegistry: WorkspaceRegistry;
  workspaceLifecycleService: WorkspaceLifecycleService;
};

export function registerWorkspaceLifecycleTools(
  server: McpServer,
  { config, workspaceRegistry, workspaceLifecycleService }: RegisterWorkspaceLifecycleToolsOptions,
): void {
  registerAppTool(
    server,
    CREATE_WORKSPACE_TOOL_NAME,
    {
      title: "Create workspace",
      description:
        "Creates a process-local Workspace record and a local workspace directory under the configured workspace root. This does not clone repositories, apply patches, or run commands yet.",
      inputSchema: createWorkspaceInputSchema,
      outputSchema: createWorkspaceOutputSchema,
      annotations: { readOnlyHint: false },
      _meta: {
        ui: { resourceUri: config.ui.widgetUri },
      },
    },
    async (input) =>
      toAppToolResponse(
        buildCreateWorkspaceResult(workspaceRegistry, input),
        "Workspace created.",
      ),
  );

  registerAppTool(
    server,
    LIST_WORKSPACES_TOOL_NAME,
    {
      title: "List workspaces",
      description:
        "Lists process-local Workspace records. Deleted workspaces are hidden unless includeDeleted is true.",
      inputSchema: listWorkspacesInputSchema,
      outputSchema: listWorkspacesOutputSchema,
      annotations: { readOnlyHint: true },
      _meta: {
        ui: { resourceUri: config.ui.widgetUri },
      },
    },
    async (input) =>
      toAppToolResponse(
        buildListWorkspacesResult(workspaceRegistry, input),
        "Workspace list returned.",
      ),
  );

  registerAppTool(
    server,
    GET_WORKSPACE_TOOL_NAME,
    {
      title: "Get workspace",
      description:
        "Returns one process-local Workspace record by workspaceId, including deleted status when present.",
      inputSchema: getWorkspaceInputSchema,
      outputSchema: getWorkspaceOutputSchema,
      annotations: { readOnlyHint: true },
      _meta: {
        ui: { resourceUri: config.ui.widgetUri },
      },
    },
    async (input) =>
      toAppToolResponse(
        buildGetWorkspaceResult(workspaceRegistry, input),
        "Workspace returned.",
      ),
  );

  registerAppTool(
    server,
    DELETE_WORKSPACE_TOOL_NAME,
    {
      title: "Delete workspace",
      description:
        "Safely deletes the local workspace directory under the configured workspace root, then marks the Workspace record as deleted.",
      inputSchema: deleteWorkspaceInputSchema,
      outputSchema: deleteWorkspaceOutputSchema,
      annotations: { readOnlyHint: false },
      _meta: {
        ui: { resourceUri: config.ui.widgetUri },
      },
    },
    async (input) =>
      toAppToolResponse(
        buildDeleteWorkspaceResult(workspaceRegistry, input),
        "Workspace deleted.",
      ),
  );

  registerAppTool(
    server,
    GET_WORKSPACE_LIFECYCLE_TOOL_NAME,
    {
      title: "Get workspace lifecycle",
      description:
        "Returns the derived lifecycle snapshot for one Workspace, including TTL expiry, dirty/busy markers, blockers, and whether it can be reused safely.",
      inputSchema: getWorkspaceLifecycleInputSchema,
      outputSchema: getWorkspaceLifecycleOutputSchema,
      annotations: { readOnlyHint: true },
      _meta: {
        ui: { resourceUri: config.ui.widgetUri },
      },
    },
    async (input) =>
      toAppToolResponse(
        buildGetWorkspaceLifecycleResult(workspaceLifecycleService, input),
        "Workspace lifecycle returned.",
      ),
  );

}

function toAppToolResponse<Data>(
  structuredContent: ToolResponse<Data>,
  successText: string,
): {
  structuredContent: ToolResponse<Data>;
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    structuredContent,
    content: [
      {
        type: "text",
        text: structuredContent.ok ? successText : structuredContent.error.message,
      },
    ],
  };
}
