import { registerWorkspaceStatusTool } from "./workspace-status/register.js";
import { WORKSPACE_STATUS_TOOL_NAME } from "./workspace-status/model.js";

export const TOOL_NAMES = [WORKSPACE_STATUS_TOOL_NAME];

export function registerTools(server, config) {
  registerWorkspaceStatusTool(server, config);
}
