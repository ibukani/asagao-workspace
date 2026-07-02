import { readFileSync } from "node:fs";
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
} from "@modelcontextprotocol/ext-apps/server";

export const ASAGAO_WIDGET_RESOURCE_NAME = "asagao-widget";

export function registerUiResources(server, config) {
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
