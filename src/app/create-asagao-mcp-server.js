import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "../config/env.js";
import { createAppContext } from "./create-app-context.js";
import { registerTools } from "../tools/index.js";
import { registerUiResources } from "../ui/register-ui-resources.js";

export function createAsagaoMcpServer({
  config = loadConfig(),
  services = createAppContext(),
} = {}) {
  const server = new McpServer({
    name: config.app.id,
    version: config.app.version,
  });

  registerUiResources(server, config);
  registerTools(server, config, services);

  return server;
}
