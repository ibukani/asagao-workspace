export const SUPPORTED_MCP_METHODS = new Set(["POST", "GET", "DELETE"]);

export function isMcpRequest(pathname: string, mcpPath: string): boolean {
  return pathname === mcpPath || pathname.startsWith(`${mcpPath}/`);
}

export function isSupportedMcpMethod(method: string | undefined): boolean {
  return method !== undefined && SUPPORTED_MCP_METHODS.has(method);
}
