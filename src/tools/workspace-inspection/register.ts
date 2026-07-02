import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "../../config/env.ts";
import type { ToolResponse } from "../../domain/index.ts";
import type { WorkspaceInspectionService } from "../../services/workspace-inspection-service.ts";
import {
  GET_FILE_TREE_TOOL_NAME,
  READ_FILE_TOOL_NAME,
  SEARCH_WORKSPACE_TOOL_NAME,
  getFileTreeInputSchema,
  getFileTreeOutputSchema,
  readFileInputSchema,
  readFileOutputSchema,
  searchWorkspaceInputSchema,
  searchWorkspaceOutputSchema,
} from "./contracts.ts";
import {
  buildGetFileTreeResult,
  buildReadFileResult,
  buildSearchWorkspaceResult,
} from "./model.ts";

export type RegisterWorkspaceInspectionToolsOptions = {
  config: AppConfig;
  workspaceInspectionService: WorkspaceInspectionService;
};

export function registerWorkspaceInspectionTools(
  server: McpServer,
  { config, workspaceInspectionService }: RegisterWorkspaceInspectionToolsOptions,
): void {
  registerAppTool(
    server,
    GET_FILE_TREE_TOOL_NAME,
    {
      title: "Get file tree",
      description:
        "Lists a workspace-relative file tree under the selected workspace root path. Results are read-only, policy-checked, audited, size-limited, and do not expose host absolute paths.",
      inputSchema: getFileTreeInputSchema,
      outputSchema: getFileTreeOutputSchema,
      annotations: { readOnlyHint: true },
      _meta: {
        ui: { resourceUri: config.ui.widgetUri },
      },
    },
    async (input) =>
      toAppToolResponse(
        await buildGetFileTreeResult(workspaceInspectionService, input),
        "Workspace file tree returned.",
      ),
  );

  registerAppTool(
    server,
    READ_FILE_TOOL_NAME,
    {
      title: "Read file",
      description:
        "Reads one UTF-8 text file from a workspace-relative path with line and byte limits. Binary files, denied paths, and paths outside the workspace are rejected.",
      inputSchema: readFileInputSchema,
      outputSchema: readFileOutputSchema,
      annotations: { readOnlyHint: true },
      _meta: {
        ui: { resourceUri: config.ui.widgetUri },
      },
    },
    async (input) =>
      toAppToolResponse(
        await buildReadFileResult(workspaceInspectionService, input),
        "Workspace file returned.",
      ),
  );

  registerAppTool(
    server,
    SEARCH_WORKSPACE_TOOL_NAME,
    {
      title: "Search workspace",
      description:
        "Searches UTF-8 text files inside a workspace by literal keyword. Results are workspace-relative, size-limited, policy-checked, and skip binary, too-large, denied, and unreadable files.",
      inputSchema: searchWorkspaceInputSchema,
      outputSchema: searchWorkspaceOutputSchema,
      annotations: { readOnlyHint: true },
      _meta: {
        ui: { resourceUri: config.ui.widgetUri },
      },
    },
    async (input) =>
      toAppToolResponse(
        await buildSearchWorkspaceResult(workspaceInspectionService, input),
        "Workspace search returned.",
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
