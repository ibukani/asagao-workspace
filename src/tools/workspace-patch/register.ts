import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "../../config/env.ts";
import type { ToolResponse } from "../../domain/index.ts";
import type { WorkspacePatchService } from "../../services/workspace-patch-service.ts";
import {
  APPLY_PATCH_TOOL_NAME,
  applyPatchInputSchema,
  applyPatchOutputSchema,
} from "./contracts.ts";
import { buildApplyPatchResult } from "./model.ts";

export type RegisterWorkspacePatchToolsOptions = {
  config: AppConfig;
  workspacePatchService: WorkspacePatchService;
};

export function registerWorkspacePatchTools(
  server: McpServer,
  { config, workspacePatchService }: RegisterWorkspacePatchToolsOptions,
): void {
  registerAppTool(
    server,
    APPLY_PATCH_TOOL_NAME,
    {
      title: "Apply patch",
      description:
        "Checks and optionally applies a unified git patch to a workspace using git apply semantics. The operation performs preflight validation, rejects unsafe target paths, records audit events, and returns changed files, diffstat, git status, and structured diagnostics without echoing the patch body.",
      inputSchema: applyPatchInputSchema,
      outputSchema: applyPatchOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true },
      _meta: {
        ui: { resourceUri: config.ui.widgetUri },
      },
    },
    async (input) =>
      toAppToolResponse(
        await buildApplyPatchResult(workspacePatchService, input),
        "Workspace patch operation completed.",
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
