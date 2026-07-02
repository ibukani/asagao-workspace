import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config/env.js";

test("loadConfig returns stable defaults", () => {
  const config = loadConfig({});

  assert.equal(config.app.id, "asagao-workspace");
  assert.equal(config.app.name, "Asagao Workspace");
  assert.equal(config.app.version, "0.1.0");
  assert.equal(config.http.port, 8787);
  assert.equal(config.http.mcpPath, "/mcp");
  assert.equal(config.ui.widgetUri, "ui://widget/asagao.html");
});

test("loadConfig normalizes MCP_PATH", () => {
  const config = loadConfig({ MCP_PATH: "custom-mcp", PORT: "9000" });

  assert.equal(config.http.port, 9000);
  assert.equal(config.http.mcpPath, "/custom-mcp");
});

test("loadConfig rejects invalid ports", () => {
  assert.throws(() => loadConfig({ PORT: "not-a-port" }), /Invalid PORT value/);
});
