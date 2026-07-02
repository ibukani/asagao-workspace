export const WORKSPACE_STATUS_TOOL_NAME = "get_workspace_status";

export function buildWorkspaceStatus(
  config,
  { availableTools = [WORKSPACE_STATUS_TOOL_NAME] } = {},
) {
  return {
    appName: config.app.name,
    status: "ready_for_local_development",
    mcpEndpoint: `http://localhost:${config.http.port}${config.http.mcpPath}`,
    availableTools,
    nextSteps: [
      "Run npm install.",
      "Start the server with npm run dev.",
      "Validate the MCP server with npm run inspect.",
      "Use create_workspace to create an in-memory Workspace record.",
      "Expose the local server through an HTTPS tunnel before connecting it from ChatGPT.",
    ],
  };
}
