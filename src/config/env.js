import { fileURLToPath } from "node:url";

export const DEFAULT_PORT = 8787;
export const DEFAULT_MCP_PATH = "/mcp";
export const DEFAULT_APP_ID = "asagao-workspace";
export const DEFAULT_APP_NAME = "Asagao Workspace";
export const DEFAULT_APP_VERSION = "0.1.0";
export const DEFAULT_WIDGET_URI = "ui://widget/asagao.html";

const WIDGET_FILE_URL = new URL("../../public/asagao-widget.html", import.meta.url);

export function loadConfig(env = process.env) {
  return {
    app: {
      id: env.APP_ID ?? DEFAULT_APP_ID,
      name: env.APP_NAME ?? DEFAULT_APP_NAME,
      version: env.APP_VERSION ?? DEFAULT_APP_VERSION,
    },
    http: {
      port: parsePort(env.PORT),
      mcpPath: normalizePath(env.MCP_PATH ?? DEFAULT_MCP_PATH),
    },
    ui: {
      widgetUri: env.WIDGET_URI ?? DEFAULT_WIDGET_URI,
      widgetFilePath: fileURLToPath(WIDGET_FILE_URL),
    },
  };
}

function parsePort(rawPort) {
  if (rawPort === undefined || rawPort === "") {
    return DEFAULT_PORT;
  }

  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT value: ${rawPort}`);
  }

  return port;
}

function normalizePath(path) {
  if (!path.startsWith("/")) {
    return `/${path}`;
  }

  return path;
}
