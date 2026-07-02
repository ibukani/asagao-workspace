import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = Number(process.env.PORT ?? 8787);
const MCP_PATH = "/mcp";
const UI_URI = "ui://widget/asagao.html";
const widgetHtml = readFileSync(join(__dirname, "public", "asagao-widget.html"), "utf8");

const statusInputSchema = {};
const statusOutputSchema = {
  appName: z.string(),
  status: z.string(),
  mcpEndpoint: z.string(),
  availableTools: z.array(z.string()),
  nextSteps: z.array(z.string()),
};

function createAsagaoServer() {
  const server = new McpServer({
    name: "asagao-workspace",
    version: "0.1.0",
  });

  registerAppResource(server, "asagao-widget", UI_URI, {}, async () => ({
    contents: [
      {
        uri: UI_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: widgetHtml,
      },
    ],
  }));

  registerAppTool(
    server,
    "get_workspace_status",
    {
      title: "Get workspace status",
      description:
        "Returns the current development status of the Asagao Workspace ChatGPT App scaffold.",
      inputSchema: statusInputSchema,
      outputSchema: statusOutputSchema,
      annotations: { readOnlyHint: true },
      _meta: {
        ui: { resourceUri: UI_URI },
      },
    },
    async () => {
      const structuredContent = {
        appName: "Asagao Workspace",
        status: "ready_for_local_development",
        mcpEndpoint: `http://localhost:${PORT}${MCP_PATH}`,
        availableTools: ["get_workspace_status"],
        nextSteps: [
          "Run npm install.",
          "Start the server with npm run dev.",
          "Validate the MCP server with npm run inspect.",
          "Expose the local server through an HTTPS tunnel before connecting it from ChatGPT.",
        ],
      };

      return {
        structuredContent,
        content: [
          {
            type: "text",
            text: "Asagao Workspace is ready for local ChatGPT App development.",
          },
        ],
      };
    },
  );

  return server;
}

function writeText(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    ...headers,
  });
  res.end(body);
}

function isMcpRequest(pathname) {
  return pathname === MCP_PATH || pathname.startsWith(`${MCP_PATH}/`);
}

const httpServer = createServer(async (req, res) => {
  if (!req.url) {
    writeText(res, 400, "Missing URL");
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "GET" && url.pathname === "/") {
    writeText(res, 200, "Asagao Workspace MCP server is running.");
    return;
  }

  if (req.method === "OPTIONS" && isMcpRequest(url.pathname)) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, mcp-session-id",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    });
    res.end();
    return;
  }

  const supportedMcpMethods = new Set(["POST", "GET", "DELETE"]);
  if (isMcpRequest(url.pathname) && req.method && supportedMcpMethods.has(req.method)) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    const server = createAsagaoServer();
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
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        writeText(res, 500, "Internal server error");
      }
    }
    return;
  }

  writeText(res, 404, "Not Found");
});

httpServer.listen(PORT, () => {
  console.log(`Asagao Workspace MCP server listening on http://localhost:${PORT}${MCP_PATH}`);
});
