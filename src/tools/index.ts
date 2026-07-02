import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "../config/env.ts";
import { registerWorkspaceStatusTool } from "./workspace-status/register.ts";
import { WORKSPACE_STATUS_TOOL_NAME } from "./workspace-status/model.ts";

export const TOOL_NAMES = [WORKSPACE_STATUS_TOOL_NAME];

export function registerTools(server: McpServer, config: AppConfig): void {
  registerWorkspaceStatusTool(server, config);
}
