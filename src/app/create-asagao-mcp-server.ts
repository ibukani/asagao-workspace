import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type AppConfig, loadConfig } from "../config/env.ts";
import { registerTools } from "../tools/index.ts";
import { registerUiResources } from "../ui/register-ui-resources.ts";

type CreateAsagaoMcpServerOptions = {
  config?: AppConfig;
};

export function createAsagaoMcpServer({
  config = loadConfig(),
}: CreateAsagaoMcpServerOptions = {}): McpServer {
  const server = new McpServer({
    name: config.app.id,
    version: config.app.version,
  });

  registerUiResources(server, config);
  registerTools(server, config);

  return server;
}
