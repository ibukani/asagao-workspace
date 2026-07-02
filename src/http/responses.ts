import type { ServerResponse } from "node:http";

export function writeText(
  res: ServerResponse,
  statusCode: number,
  body: string,
  headers: Record<string, string> = {},
): void {
  res.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    ...headers,
  });
  res.end(body);
}

export function writeCorsPreflight(res: ServerResponse): void {
  res.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, mcp-session-id",
    "Access-Control-Expose-Headers": "Mcp-Session-Id",
  });
  res.end();
}

export function setMcpCorsHeaders(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
}
