import { readFileSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
} from "@modelcontextprotocol/ext-apps/server";
import type { AppConfig } from "../config/env.ts";

export const ASAGAO_WIDGET_RESOURCE_NAME = "asagao-widget";

export function registerUiResources(server: McpServer, config: AppConfig): void {
  const widgetHtml = readFileSync(config.ui.widgetFilePath, "utf8");

  registerAppResource(server, ASAGAO_WIDGET_RESOURCE_NAME, config.ui.widgetUri, {}, async () => ({
    contents: [
      {
        uri: config.ui.widgetUri,
        mimeType: RESOURCE_MIME_TYPE,
        text: widgetHtml,
      },
    ],
  }));
}
