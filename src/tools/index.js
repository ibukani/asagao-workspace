import { registerWorkspaceLifecycleTools } from "./workspace-lifecycle/register.js";
import { WORKSPACE_LIFECYCLE_TOOL_NAMES } from "./workspace-lifecycle/contracts.js";
import { registerWorkspaceStatusTool } from "./workspace-status/register.js";
import { WORKSPACE_STATUS_TOOL_NAME } from "./workspace-status/model.js";

export const TOOL_NAMES = Object.freeze([
  WORKSPACE_STATUS_TOOL_NAME,
  ...WORKSPACE_LIFECYCLE_TOOL_NAMES,
]);

export function registerTools(server, config, services) {
  registerWorkspaceStatusTool(server, config, { availableTools: TOOL_NAMES });
  registerWorkspaceLifecycleTools(server, {
    config,
    workspaceRegistry: services.workspaceRegistry,
  });
}
