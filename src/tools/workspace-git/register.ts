import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "../../config/env.ts";
import type { ToolResponse } from "../../domain/index.ts";
import type { WorkspaceGitService } from "../../services/workspace-git-service.ts";
import {
  GET_GIT_STATUS_TOOL_NAME,
  GET_WORKSPACE_DIFF_TOOL_NAME,
  getGitStatusInputSchema,
  getGitStatusOutputSchema,
  getWorkspaceDiffInputSchema,
  getWorkspaceDiffOutputSchema,
} from "./contracts.ts";
import {
  buildGetGitStatusResult,
  buildGetWorkspaceDiffResult,
} from "./model.ts";

export type RegisterWorkspaceGitToolsOptions = {
  config: AppConfig;
  workspaceGitService: WorkspaceGitService;
};

export function registerWorkspaceGitTools(
  server: McpServer,
  { config, workspaceGitService }: RegisterWorkspaceGitToolsOptions,
): void {
  registerAppTool(
    server,
    GET_GIT_STATUS_TOOL_NAME,
    {
      title: "Get git status",
      description:
        "Returns structured git status for a workspace, including branch, HEAD commit, changed files, per-file status, and truncation metadata. This read-only operation never exposes host absolute paths.",
      inputSchema: getGitStatusInputSchema,
      outputSchema: getGitStatusOutputSchema,
      annotations: { readOnlyHint: true },
      _meta: {
        ui: { resourceUri: config.ui.widgetUri },
      },
    },
    async (input) =>
      toAppToolResponse(
        await buildGetGitStatusResult(workspaceGitService, input),
        "Workspace git status returned.",
      ),
  );

  registerAppTool(
    server,
    GET_WORKSPACE_DIFF_TOOL_NAME,
    {
      title: "Get workspace diff",
      description:
        "Returns structured workspace git diff data, including changed files, diffstat, and an optional size-limited patch body. Binary, deleted, untracked, and oversized diffs are reported with stable metadata.",
      inputSchema: getWorkspaceDiffInputSchema,
      outputSchema: getWorkspaceDiffOutputSchema,
      annotations: { readOnlyHint: true },
      _meta: {
        ui: { resourceUri: config.ui.widgetUri },
      },
    },
    async (input) =>
      toAppToolResponse(
        await buildGetWorkspaceDiffResult(workspaceGitService, input),
        "Workspace diff returned.",
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
