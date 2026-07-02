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

export function createAsagaoMcpServer(
  options: CreateAsagaoMcpServerOptions = {},
): McpServer {
  const config = options.config ?? loadConfig();
  const services = options.services ?? createAppContext({ config });
  const server = new McpServer({
    name: config.app.id,
    version: config.app.version,
  });

  registerUiResources(server, config);
  registerTools(server, config, services);

  return server;
}
