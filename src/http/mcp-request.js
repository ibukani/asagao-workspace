export const SUPPORTED_MCP_METHODS = new Set(["POST", "GET", "DELETE"]);

export function isMcpRequest(pathname, mcpPath) {
  return pathname === mcpPath || pathname.startsWith(`${mcpPath}/`);
}

export function isSupportedMcpMethod(method) {
  return method !== undefined && SUPPORTED_MCP_METHODS.has(method);
}
