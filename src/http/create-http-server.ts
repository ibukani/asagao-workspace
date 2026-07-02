import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  createAppContext,
  type AppServices,
} from "../app/create-app-context.ts";
import { createAsagaoMcpServer } from "../app/create-asagao-mcp-server.ts";
import { type AppConfig, loadConfig } from "../config/env.ts";
import { isMcpRequest, isSupportedMcpMethod } from "./mcp-request.ts";
import {
  setMcpCorsHeaders,
  writeCorsPreflight,
  writeText,
} from "./responses.ts";

type Logger = Pick<Console, "error">;

type McpServerLike = {
  connect: (transport: StreamableHTTPServerTransport) => Promise<void>;
  close: () => Promise<void> | void;
};

type CreateMcpServer = (options: {
  config: AppConfig;
  services: AppServices;
}) => McpServerLike;

type CreateHttpServerOptions = {
  config?: AppConfig;
  createMcpServer?: CreateMcpServer;
  logger?: Logger;
  services?: AppServices;
};

export function createAsagaoHttpServer(
  options: CreateHttpServerOptions = {},
): Server {
  const config = options.config ?? loadConfig();
  const createMcpServer = options.createMcpServer ?? createAsagaoMcpServer;
  const logger = options.logger ?? console;
  const services = options.services ?? createAppContext({ config });

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
      await handleMcpRequest({ req, res, config, createMcpServer, logger, services });
      return;
    }

    writeText(res, 404, "Not Found");
  });
}

async function handleMcpRequest({
  req,
  res,
  config,
  createMcpServer,
  logger,
  services,
}: {
  req: IncomingMessage;
  res: ServerResponse;
  config: AppConfig;
  createMcpServer: CreateMcpServer;
  logger: Logger;
  services: AppServices;
}): Promise<void> {
  const server = createMcpServer({ config, services });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on("close", () => {
    transport.close();
    void server.close();
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
