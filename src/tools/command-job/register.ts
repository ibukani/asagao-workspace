import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "../../config/env.ts";
import type { ToolResponse } from "../../domain/index.ts";
import type { CommandJobService } from "../../services/command-job-service.ts";
import {
  GET_COMMAND_STATUS_TOOL_NAME,
  RUN_COMMAND_TOOL_NAME,
  getCommandStatusInputSchema,
  getCommandStatusOutputSchema,
  runCommandInputSchema,
  runCommandOutputSchema,
} from "./contracts.ts";
import {
  buildGetCommandStatusResult,
  buildRunCommandResult,
} from "./model.ts";

export type RegisterCommandJobToolsOptions = {
  config: AppConfig;
  commandJobService: CommandJobService;
};

export function registerCommandJobTools(
  server: McpServer,
  { config, commandJobService }: RegisterCommandJobToolsOptions,
): void {
  registerAppTool(
    server,
    RUN_COMMAND_TOOL_NAME,
    {
      title: "Run command",
      description:
        "Queues an allowlisted fixed-argument command inside a workspace and immediately returns a command job record. Commands are not shell strings; cwd is limited to the workspace; timeout is required and enforced by policy.",
      inputSchema: runCommandInputSchema,
      outputSchema: runCommandOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true },
      _meta: {
        ui: { resourceUri: config.ui.widgetUri },
      },
    },
    async (input) =>
      toAppToolResponse(
        await buildRunCommandResult(commandJobService, input),
        "Command job queued.",
      ),
  );

  registerAppTool(
    server,
    GET_COMMAND_STATUS_TOOL_NAME,
    {
      title: "Get command status",
      description:
        "Returns the current structured status for a command job, including exit code, elapsed time, stdout/stderr capture metadata, and terminal failure details when available.",
      inputSchema: getCommandStatusInputSchema,
      outputSchema: getCommandStatusOutputSchema,
      annotations: { readOnlyHint: true },
      _meta: {
        ui: { resourceUri: config.ui.widgetUri },
      },
    },
    async (input) =>
      toAppToolResponse(
        await buildGetCommandStatusResult(commandJobService, input),
        "Command job status returned.",
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
