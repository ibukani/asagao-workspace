import type { AppConfig } from "../../config/env.ts";

export const WORKSPACE_STATUS_TOOL_NAME = "get_workspace_status";

export type WorkspaceStatus = {
  appName: string;
  status: "ready_for_local_development";
  mcpEndpoint: string;
  availableTools: string[];
  nextSteps: string[];
};

export function buildWorkspaceStatus(config: AppConfig): WorkspaceStatus {
  return {
    appName: config.app.name,
    status: "ready_for_local_development",
    mcpEndpoint: `http://localhost:${config.http.port}${config.http.mcpPath}`,
    availableTools: [WORKSPACE_STATUS_TOOL_NAME],
    nextSteps: [
      "Run npm install.",
      "Start the server with npm run dev.",
      "Validate the MCP server with npm run inspect.",
      "Expose the local server through an HTTPS tunnel before connecting it from ChatGPT.",
    ],
  };
}
