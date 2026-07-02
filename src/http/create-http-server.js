import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createAsagaoMcpServer } from "../app/create-asagao-mcp-server.js";
import { loadConfig } from "../config/env.js";
import { isMcpRequest, isSupportedMcpMethod } from "./mcp-request.js";
import {
  setMcpCorsHeaders,
  writeCorsPreflight,
  writeText,
} from "./responses.js";

export function createAsagaoHttpServer({
  config = loadConfig(),
  createMcpServer = createAsagaoMcpServer,
  logger = console,
} = {}) {
  return createServer(async (req, res) => {
    if (!req.url) {
      writeText(res, 400, "Missing URL");
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "GET" && url.pathname === "/") {
      writeText(res, 200, `${config.app.name} MCP server is running.`);
      return;
    }

    if (req.method === "OPTIONS" && isMcpRequest(url.pathname, config.http.mcpPath)) {
      writeCorsPreflight(res);
      return;
    }

    if (isMcpRequest(url.pathname, config.http.mcpPath) && isSupportedMcpMethod(req.method)) {
      setMcpCorsHeaders(res);
      await handleMcpRequest({ req, res, config, createMcpServer, logger });
      return;
    }

    writeText(res, 404, "Not Found");
  });
}

async function handleMcpRequest({ req, res, config, createMcpServer, logger }) {
  const server = createMcpServer({ config });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on("close", () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (error) {
    logger.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      writeText(res, 500, "Internal server error");
    }
  }
}
