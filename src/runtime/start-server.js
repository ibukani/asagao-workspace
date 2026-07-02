import { loadConfig } from "../config/env.js";
import { createAsagaoHttpServer } from "../http/create-http-server.js";

export async function startServer({ config = loadConfig(), logger = console } = {}) {
  const httpServer = createAsagaoHttpServer({ config, logger });

  await new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(config.http.port, () => {
      httpServer.off("error", reject);
      resolve();
    });
  });

  logger.log(
    `${config.app.name} MCP server listening on http://localhost:${config.http.port}${config.http.mcpPath}`,
  );

  return httpServer;
}
