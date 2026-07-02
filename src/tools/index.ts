import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppServices } from "../app/create-app-context.ts";
import type { AppConfig } from "../config/env.ts";
import { registerWorkspaceInspectionTools } from "./workspace-inspection/register.ts";
import { WORKSPACE_INSPECTION_TOOL_NAMES } from "./workspace-inspection/contracts.ts";
import { registerWorkspaceLifecycleTools } from "./workspace-lifecycle/register.ts";
import { WORKSPACE_LIFECYCLE_TOOL_NAMES } from "./workspace-lifecycle/contracts.ts";
import { registerWorkspaceStatusTool } from "./workspace-status/register.ts";
import { WORKSPACE_STATUS_TOOL_NAME } from "./workspace-status/model.ts";

export const TOOL_NAMES = [
  WORKSPACE_STATUS_TOOL_NAME,
  ...WORKSPACE_LIFECYCLE_TOOL_NAMES,
  ...WORKSPACE_INSPECTION_TOOL_NAMES,
] as const;

export function registerTools(
  server: McpServer,
  config: AppConfig,
  services: AppServices,
): void {
  registerWorkspaceStatusTool(server, config, { availableTools: TOOL_NAMES });
  registerWorkspaceLifecycleTools(server, {
    config,
    workspaceRegistry: services.workspaceRegistry,
    workspaceLifecycleService: services.workspaceLifecycleService,
  });
  registerWorkspaceInspectionTools(server, {
    config,
    workspaceInspectionService: services.workspaceInspectionService,
  });
}
