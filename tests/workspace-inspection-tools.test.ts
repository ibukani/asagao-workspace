import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "../src/config/env.ts";
import { createRunnerSecurityServices } from "../src/security/index.ts";
import { LocalWorkspaceFilesystem } from "../src/services/local-workspace-filesystem.ts";
import { WorkspaceInspectionService } from "../src/services/workspace-inspection-service.ts";
import { WorkspaceRegistry } from "../src/services/workspace-registry.ts";
import { InMemoryWorkspaceStore } from "../src/storage/in-memory-workspace-store.ts";
import {
  getFileTreeOutputSchema,
  readFileOutputSchema,
  searchWorkspaceOutputSchema,
} from "../src/tools/workspace-inspection/contracts.ts";
import {
  buildGetFileTreeResult,
  buildReadFileResult,
  buildSearchWorkspaceResult,
} from "../src/tools/workspace-inspection/model.ts";
import { registerWorkspaceInspectionTools } from "../src/tools/workspace-inspection/register.ts";

type RegisteredToolHandler = (input: unknown) => Promise<{
  structuredContent: unknown;
  content: Array<{ type: "text"; text: string }>;
}>;

type RegisteredToolRecord = {
  config: unknown;
  handler: RegisteredToolHandler;
};

function createFakeMcpServer() {
  const tools = new Map<string, RegisteredToolRecord>();

  const server = {
    registerTool(name: string, config: unknown, handler: RegisteredToolHandler) {
      tools.set(name, { config, handler });
      return { name };
    },
  } as unknown as McpServer;

  return { server, tools };
}

function createFixture() {
  const parent = mkdtempSync(join(tmpdir(), "asagao-inspection-tools-"));
  const workspaceRoot = join(parent, "workspaces");
  const filesystem = new LocalWorkspaceFilesystem({ workspaceRoot });
  const registry = new WorkspaceRegistry({
    store: new InMemoryWorkspaceStore(),
    filesystem,
    clock: () => new Date("2026-07-02T12:00:00.000Z"),
    createId: () => "wks_toolinspect001",
  });
  const workspace = registry.createWorkspace({ workspaceName: "Tool inspection workspace" });
  const workspaceDirectory = join(workspaceRoot, workspace.workspaceId);
  const service = new WorkspaceInspectionService({
    workspaceRegistry: registry,
    workspaceFilesystem: filesystem,
    security: createRunnerSecurityServices(),
    clock: () => new Date("2026-07-02T12:00:00.000Z"),
  });

  return { parent, workspace, workspaceDirectory, service };
}

test("workspace inspection model returns structured tree, file, and search results", async () => {
  const fixture = createFixture();
  try {
    writeFileSync(join(fixture.workspaceDirectory, "README.md"), "hello needle\n");

    const tree = await buildGetFileTreeResult(fixture.service, {
      workspaceId: fixture.workspace.workspaceId,
    });
    const file = await buildReadFileResult(fixture.service, {
      workspaceId: fixture.workspace.workspaceId,
      path: "README.md",
    });
    const search = await buildSearchWorkspaceResult(fixture.service, {
      workspaceId: fixture.workspace.workspaceId,
      query: "needle",
    });

    assert.equal(tree.ok, true);
    assert.equal(tree.data.entries[0]?.path, "README.md");
    assert.equal(getFileTreeOutputSchema.safeParse(tree).success, true);

    assert.equal(file.ok, true);
    assert.equal(file.data.file.content, "hello needle\n");
    assert.equal(readFileOutputSchema.safeParse(file).success, true);

    assert.equal(search.ok, true);
    assert.equal(search.data.matches[0]?.path, "README.md");
    assert.equal(searchWorkspaceOutputSchema.safeParse(search).success, true);
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});

test("workspace inspection model reports invalid input and missing workspaces as failures", async () => {
  const fixture = createFixture();
  try {
    const invalid = await buildReadFileResult(fixture.service, {
      workspaceId: fixture.workspace.workspaceId,
      path: "README.md",
      maxLines: 0,
    });
    const missing = await buildSearchWorkspaceResult(fixture.service, {
      workspaceId: "wks_missing001",
      query: "needle",
    });
    const missingRoot = await buildSearchWorkspaceResult(fixture.service, {
      workspaceId: fixture.workspace.workspaceId,
      query: "needle",
      rootPath: "missing",
    });

    assert.equal(invalid.ok, false);
    assert.equal(invalid.error.code, "invalid_input");
    assert.equal(readFileOutputSchema.safeParse(invalid).success, true);

    assert.equal(missing.ok, false);
    assert.equal(missing.error.code, "workspace_not_found");
    assert.equal(searchWorkspaceOutputSchema.safeParse(missing).success, true);

    assert.equal(missingRoot.ok, false);
    assert.equal(missingRoot.error.code, "file_not_found");
    assert.equal(searchWorkspaceOutputSchema.safeParse(missingRoot).success, true);
    const serialized = JSON.stringify(missingRoot);
    assert.equal(serialized.includes(fixture.workspaceDirectory), false);
    assert.doesNotMatch(serialized, /LocalWorkspaceTraversal|AdapterError|fast-glob|FastGlob/i);
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});

test("workspace inspection registration wires Apps SDK handlers to the shared service", async () => {
  const fixture = createFixture();
  try {
    writeFileSync(join(fixture.workspaceDirectory, "README.md"), "hello needle\n");
    assert.equal(existsSync(join(fixture.workspaceDirectory, "README.md")), true);

    const { server, tools } = createFakeMcpServer();
    registerWorkspaceInspectionTools(server, {
      config: loadConfig({ PORT: "9999" }),
      workspaceInspectionService: fixture.service,
    });

    assert.deepEqual([...tools.keys()], [
      "get_file_tree",
      "read_file",
      "search_workspace",
    ]);

    const treeHandler = requireRegisteredHandler(tools, "get_file_tree");
    const fileHandler = requireRegisteredHandler(tools, "read_file");
    const searchHandler = requireRegisteredHandler(tools, "search_workspace");

    const tree = await treeHandler({ workspaceId: fixture.workspace.workspaceId });
    const file = await fileHandler({
      workspaceId: fixture.workspace.workspaceId,
      path: "README.md",
    });
    const search = await searchHandler({
      workspaceId: fixture.workspace.workspaceId,
      query: "needle",
    });

    assert.equal(tree.content[0]?.text, "Workspace file tree returned.");
    assert.equal(getFileTreeOutputSchema.safeParse(tree.structuredContent).success, true);
    assert.equal(file.content[0]?.text, "Workspace file returned.");
    assert.equal(readFileOutputSchema.safeParse(file.structuredContent).success, true);
    assert.equal(search.content[0]?.text, "Workspace search returned.");
    assert.equal(searchWorkspaceOutputSchema.safeParse(search.structuredContent).success, true);
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});

function requireRegisteredHandler(
  tools: Map<string, RegisteredToolRecord>,
  name: string,
): RegisteredToolHandler {
  const handler = tools.get(name)?.handler;
  assert.ok(handler, `expected ${name} to be registered`);
  return handler;
}
