import type { Server } from "node:http";
import { type AppConfig, loadConfig } from "../config/env.ts";
import { createAsagaoHttpServer } from "../http/create-http-server.ts";

type Logger = Pick<Console, "log" | "error">;

type StartServerOptions = {
  config?: AppConfig;
  logger?: Logger;
};

export async function startServer({
  config = loadConfig(),
  logger = console,
}: StartServerOptions = {}): Promise<Server> {
  const httpServer = createAsagaoHttpServer({ config, logger });

  await new Promise<void>((resolve, reject) => {
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
