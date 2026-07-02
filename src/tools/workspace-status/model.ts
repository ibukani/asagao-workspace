import type { AppConfig } from "../../config/env.ts";

export const WORKSPACE_STATUS_TOOL_NAME = "get_workspace_status";

export type WorkspaceStatus = {
  appName: string;
  status: "ready_for_local_development";
  mcpEndpoint: string;
  availableTools: string[];
  nextSteps: string[];
};

export type BuildWorkspaceStatusOptions = {
  availableTools?: readonly string[];
};

export function buildWorkspaceStatus(
  config: AppConfig,
  { availableTools = [WORKSPACE_STATUS_TOOL_NAME] }: BuildWorkspaceStatusOptions = {},
): WorkspaceStatus {
  return {
    appName: config.app.name,
    status: "ready_for_local_development",
    mcpEndpoint: `http://localhost:${config.http.port}${config.http.mcpPath}`,
    availableTools: [...availableTools],
    nextSteps: [
      "Run npm install.",
      "Start the server with npm run dev.",
      "Validate the MCP server with npm run inspect.",
      "Expose the local server through an HTTPS tunnel before connecting it from ChatGPT.",
    ],
  };
}
