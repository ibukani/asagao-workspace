import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type AppConfig, loadConfig } from "../config/env.ts";
import {
  createAppContext,
  type AppServices,
} from "./create-app-context.ts";
import { registerTools } from "../tools/index.ts";
import { registerUiResources } from "../ui/register-ui-resources.ts";

type CreateAsagaoMcpServerOptions = {
  config?: AppConfig;
  services?: AppServices;
};

export function createAsagaoMcpServer({
  config = loadConfig(),
  services = createAppContext(),
}: CreateAsagaoMcpServerOptions = {}): McpServer {
  const server = new McpServer({
    name: config.app.id,
    version: config.app.version,
  });

  registerUiResources(server, config);
  registerTools(server, config, services);

  return server;
}
