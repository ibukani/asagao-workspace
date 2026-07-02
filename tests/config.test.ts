import test from "node:test";
import assert from "node:assert/strict";
import { parse, resolve } from "node:path";
import {
  DEFAULT_WORKSPACE_ROOT,
} from "../src/filesystem/workspace-paths.ts";
import { loadConfig } from "../src/config/env.ts";

test("loadConfig returns stable defaults", () => {
  const config = loadConfig({});

  assert.equal(config.app.id, "asagao-workspace");
  assert.equal(config.app.name, "Asagao Workspace");
  assert.equal(config.app.version, "0.1.0");
  assert.equal(config.http.port, 8787);
  assert.equal(config.http.mcpPath, "/mcp");
  assert.equal(config.ui.widgetUri, "ui://widget/asagao.html");
  assert.equal(config.workspace.rootPath, resolve(DEFAULT_WORKSPACE_ROOT));
});

test("loadConfig normalizes MCP_PATH", () => {
  const config = loadConfig({ MCP_PATH: "custom-mcp", PORT: "9000" });

  assert.equal(config.http.port, 9000);
  assert.equal(config.http.mcpPath, "/custom-mcp");
});

test("loadConfig normalizes ASAGAO_WORKSPACE_ROOT", () => {
  const config = loadConfig({
    ASAGAO_WORKSPACE_ROOT: "custom/workspaces",
    PORT: "9000",
  });

  assert.equal(config.workspace.rootPath, resolve("custom/workspaces"));
});

test("loadConfig accepts absolute ASAGAO_WORKSPACE_ROOT", () => {
  const workspaceRoot = resolve("/tmp/asagao-workspace-test-root");
  const config = loadConfig({ ASAGAO_WORKSPACE_ROOT: workspaceRoot });

  assert.equal(config.workspace.rootPath, workspaceRoot);
});

test("loadConfig rejects invalid ports", () => {
  assert.throws(() => loadConfig({ PORT: "not-a-port" }), /Invalid PORT value/);
});

test("loadConfig rejects unsafe workspace roots", () => {
  assert.throws(
    () => loadConfig({ ASAGAO_WORKSPACE_ROOT: "" }),
    /Workspace root must not be empty/,
  );
  assert.throws(
    () => loadConfig({ ASAGAO_WORKSPACE_ROOT: "bad\0root" }),
    /Workspace root must not contain NUL bytes/,
  );
  assert.throws(
    () => loadConfig({ ASAGAO_WORKSPACE_ROOT: "file:///tmp/asagao" }),
    /Workspace root must be a filesystem path/,
  );
  assert.throws(
    () => loadConfig({ ASAGAO_WORKSPACE_ROOT: parse(process.cwd()).root }),
    /Workspace root must not be the filesystem root/,
  );
});
