import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import {
  buildWorkspaceStatus,
  WORKSPACE_STATUS_TOOL_NAME,
} from "./model.js";

const inputSchema = {};
const outputSchema = {
  appName: z.string(),
  status: z.string(),
  mcpEndpoint: z.string(),
  availableTools: z.array(z.string()),
  nextSteps: z.array(z.string()),
};

export function registerWorkspaceStatusTool(server, config) {
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
      const structuredContent = buildWorkspaceStatus(config);

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
