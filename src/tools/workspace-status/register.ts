import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import type { AppConfig } from "../../config/env.ts";
import {
  buildWorkspaceStatus,
  WORKSPACE_STATUS_TOOL_NAME,
} from "./model.ts";

const inputSchema = {};
const outputSchema = {
  appName: z.string(),
  status: z.string(),
  mcpEndpoint: z.string(),
  availableTools: z.array(z.string()),
  nextSteps: z.array(z.string()),
};

export type RegisterWorkspaceStatusToolOptions = {
  availableTools?: readonly string[];
};

export function registerWorkspaceStatusTool(
  server: McpServer,
  config: AppConfig,
  options: RegisterWorkspaceStatusToolOptions = {},
): void {
  registerAppTool(
    server,
    WORKSPACE_STATUS_TOOL_NAME,
    {
      title: "Get workspace status",
      description:
        "Returns the current development status of the Asagao Workspace ChatGPT App scaffold.",
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: true },
      _meta: {
        ui: { resourceUri: config.ui.widgetUri },
      },
    },
    async () => {
      const structuredContent = buildWorkspaceStatus(config, options);

      return {
        structuredContent,
        content: [
          {
            type: "text",
            text: `${config.app.name} is ready for local ChatGPT App development.`,
          },
        ],
      };
    },
  );
}
