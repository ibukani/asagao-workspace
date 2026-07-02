import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "../src/config/env.ts";
import { LocalWorkspaceFilesystem } from "../src/services/local-workspace-filesystem.ts";
import { WorkspaceLifecycleService } from "../src/services/workspace-lifecycle-service.ts";
import { WorkspaceRegistry } from "../src/services/workspace-registry.ts";
import { InMemoryWorkspaceStore } from "../src/storage/in-memory-workspace-store.ts";
import { InMemoryWorkspaceLifecycleStore } from "../src/storage/in-memory-workspace-lifecycle-store.ts";
import { createRunnerSecurityServices } from "../src/security/index.ts";
import {
  buildCreateWorkspaceResult,
  buildDeleteWorkspaceResult,
  buildGetWorkspaceResult,
  buildGetWorkspaceLifecycleResult,
  buildListWorkspacesResult,
  WORKSPACE_LIFECYCLE_ERROR_CODES,
  type ListWorkspacesResult,
} from "../src/tools/workspace-lifecycle/model.ts";
import {
  createWorkspaceOutputSchema,
  deleteWorkspaceOutputSchema,
  getWorkspaceLifecycleOutputSchema,
  getWorkspaceOutputSchema,
  listWorkspacesOutputSchema,
} from "../src/tools/workspace-lifecycle/contracts.ts";
import { registerWorkspaceLifecycleTools } from "../src/tools/workspace-lifecycle/register.ts";

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

function createRegistry() {
  let sequence = 0;

  return new WorkspaceRegistry({
    store: new InMemoryWorkspaceStore(),
    clock: () => new Date("2026-07-02T12:00:00.000Z"),
    createId: () => `wks_tool00${++sequence}`,
  });
}

function createLifecycleService(registry: WorkspaceRegistry): WorkspaceLifecycleService {
  return new WorkspaceLifecycleService({
    workspaceRegistry: registry,
    lifecycleStore: new InMemoryWorkspaceLifecycleStore(),
    security: createRunnerSecurityServices(),
    clock: () => new Date("2026-07-02T12:00:00.000Z"),
  });
}

test("workspace lifecycle model creates workspaces through the registry", () => {
  const registry = createRegistry();
  const response = buildCreateWorkspaceResult(registry, {
    workspaceName: "Tool workspace",
    ttlMinutes: 30,
  });

  assert.equal(response.ok, true);
  assert.equal(response.data.workspace.workspaceId, "wks_tool001");
  assert.equal(response.data.workspace.name, "Tool workspace");
  assert.equal(response.data.workspace.expiresAt, "2026-07-02T12:30:00.000Z");
  assert.equal(createWorkspaceOutputSchema.safeParse(response).success, true);
});

test("workspace lifecycle model reports invalid input as structured failure", () => {
  const registry = createRegistry();
  const response = buildCreateWorkspaceResult(registry, { branch: "main" });

  assert.equal(response.ok, false);
  assert.equal(response.error.code, WORKSPACE_LIFECYCLE_ERROR_CODES.invalidInput);
  assert.equal(createWorkspaceOutputSchema.safeParse(response).success, true);
});

test("workspace lifecycle model lists and filters workspaces", () => {
  const registry = createRegistry();
  const first = buildCreateWorkspaceResult(registry, { runtimeProfile: "node" });
  const second = buildCreateWorkspaceResult(registry, { runtimeProfile: "python" });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);

  const response = buildListWorkspacesResult(registry, { runtimeProfile: ["python"] });

  assert.equal(response.ok, true);
  assert.deepEqual(
    response.data.workspaces.map((workspace) => workspace.workspaceId),
    ["wks_tool002"],
  );
  assert.equal(listWorkspacesOutputSchema.safeParse(response).success, true);
});

test("workspace lifecycle model gets workspaces and returns not found failures", () => {
  const registry = createRegistry();
  const created = buildCreateWorkspaceResult(registry, {});
  assert.equal(created.ok, true);

  const found = buildGetWorkspaceResult(registry, {
    workspaceId: created.data.workspace.workspaceId,
  });
  const missing = buildGetWorkspaceResult(registry, { workspaceId: "wks_missing001" });

  assert.equal(found.ok, true);
  assert.equal(found.data.workspace.workspaceId, "wks_tool001");
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, WORKSPACE_LIFECYCLE_ERROR_CODES.workspaceNotFound);
  assert.equal(getWorkspaceOutputSchema.safeParse(found).success, true);
  assert.equal(getWorkspaceOutputSchema.safeParse(missing).success, true);
});



test("workspace lifecycle model returns derived reusable lifecycle snapshots", () => {
  const registry = createRegistry();
  const lifecycleService = createLifecycleService(registry);
  const created = buildCreateWorkspaceResult(registry, { ttlMinutes: 30 });
  assert.equal(created.ok, true);

  const response = buildGetWorkspaceLifecycleResult(lifecycleService, {
    workspaceId: created.data.workspace.workspaceId,
  });
  const missing = buildGetWorkspaceLifecycleResult(lifecycleService, { workspaceId: "wks_missing001" });

  assert.equal(response.ok, true);
  assert.equal(response.data.lifecycle.state, "reusable");
  assert.equal(response.data.lifecycle.reusable, true);
  assert.equal(response.data.lifecycle.expiresAt, "2026-07-02T12:30:00.000Z");
  assert.equal(getWorkspaceLifecycleOutputSchema.safeParse(response).success, true);
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, WORKSPACE_LIFECYCLE_ERROR_CODES.workspaceNotFound);
});

test("workspace lifecycle model marks workspaces deleted and hides them from default list", () => {
  const registry = createRegistry();
  const created = buildCreateWorkspaceResult(registry, {});
  assert.equal(created.ok, true);

  const deleted = buildDeleteWorkspaceResult(registry, {
    workspaceId: created.data.workspace.workspaceId,
  });
  const defaultList = buildListWorkspacesResult(registry, {});
  const fullList = buildListWorkspacesResult(registry, { includeDeleted: true });
  const found = buildGetWorkspaceResult(registry, {
    workspaceId: created.data.workspace.workspaceId,
  });

  assert.equal(deleted.ok, true);
  assert.deepEqual(deleted.data, { workspaceId: "wks_tool001", deleted: true });
  assert.equal(defaultList.ok, true);
  assert.deepEqual(defaultList.data.workspaces, []);
  assert.equal(fullList.ok, true);
  assert.equal(fullList.data.workspaces[0]?.status, "deleted");
  assert.equal(found.ok, true);
  assert.equal(found.data.workspace.status, "deleted");
  assert.equal(deleteWorkspaceOutputSchema.safeParse(deleted).success, true);
});

test("workspace lifecycle registration wires Apps SDK handlers to the shared registry", async () => {
  const registry = createRegistry();
  const lifecycleService = createLifecycleService(registry);
  const { server, tools } = createFakeMcpServer();

  registerWorkspaceLifecycleTools(server, {
    config: loadConfig({ PORT: "9999" }),
    workspaceRegistry: registry,
    workspaceLifecycleService: lifecycleService,
  });

  assert.deepEqual([...tools.keys()], [
    "create_workspace",
    "list_workspaces",
    "get_workspace",
    "delete_workspace",
    "get_workspace_lifecycle",
  ]);

  const createHandler = requireRegisteredHandler(tools, "create_workspace");
  const listHandler = requireRegisteredHandler(tools, "list_workspaces");
  const deleteHandler = requireRegisteredHandler(tools, "delete_workspace");
  const lifecycleHandler = requireRegisteredHandler(tools, "get_workspace_lifecycle");

  const created = await createHandler({ workspaceName: "Registered handler workspace" });
  assert.equal(created.content[0]?.text, "Workspace created.");
  assert.equal(createWorkspaceOutputSchema.safeParse(created.structuredContent).success, true);

  const listedBeforeDelete = await listHandler({});
  assert.equal(
    listWorkspacesOutputSchema.safeParse(listedBeforeDelete.structuredContent).success,
    true,
  );
  const currentRegistryList = expectListWorkspacesSuccess(
    buildListWorkspacesResult(registry, {}),
  );
  assert.deepEqual(
    currentRegistryList.data.workspaces.map((workspace) => workspace.name),
    ["Registered handler workspace"],
  );

  const createResult = createWorkspaceOutputSchema.parse(created.structuredContent);
  assert.equal(createResult.ok, true);


  const lifecycle = await lifecycleHandler({
    workspaceId: createResult.data.workspace.workspaceId,
  });
  assert.equal(lifecycle.content[0]?.text, "Workspace lifecycle returned.");
  assert.equal(
    getWorkspaceLifecycleOutputSchema.safeParse(lifecycle.structuredContent).success,
    true,
  );
  const lifecycleResult = getWorkspaceLifecycleOutputSchema.parse(lifecycle.structuredContent);
  assert.equal(lifecycleResult.ok, true);
  assert.equal(lifecycleResult.data.lifecycle.reusable, true);

  const deleted = await deleteHandler({
    workspaceId: createResult.data.workspace.workspaceId,
  });
  assert.equal(deleted.content[0]?.text, "Workspace deleted.");
  assert.equal(deleteWorkspaceOutputSchema.safeParse(deleted.structuredContent).success, true);

  const listedAfterDelete = await listHandler({});
  assert.equal(
    listWorkspacesOutputSchema.safeParse(listedAfterDelete.structuredContent).success,
    true,
  );
  const listResult = listWorkspacesOutputSchema.parse(listedAfterDelete.structuredContent);
  assert.equal(listResult.ok, true);
  assert.deepEqual(listResult.data.workspaces, []);
});

function requireRegisteredHandler(
  tools: Map<string, RegisteredToolRecord>,
  name: string,
): RegisteredToolHandler {
  const handler = tools.get(name)?.handler;
  assert.ok(handler, `expected ${name} to be registered`);
  return handler;
}

function expectListWorkspacesSuccess(response: ListWorkspacesResult) {
  assert.equal(response.ok, true);
  return response;
}

test("workspace lifecycle model creates and deletes local workspace directories", () => {
  const parent = mkdtempSync(join(tmpdir(), "asagao-tool-fs-"));
  try {
    const workspaceRoot = join(parent, "workspaces");
    const registry = new WorkspaceRegistry({
      store: new InMemoryWorkspaceStore(),
      filesystem: new LocalWorkspaceFilesystem({ workspaceRoot }),
      clock: () => new Date("2026-07-02T12:00:00.000Z"),
      createId: () => "wks_toolfs001",
    });

    const created = buildCreateWorkspaceResult(registry, {});
    assert.equal(created.ok, true);
    assert.equal(existsSync(join(workspaceRoot, "wks_toolfs001")), true);

    const deleted = buildDeleteWorkspaceResult(registry, { workspaceId: "wks_toolfs001" });
    assert.equal(deleted.ok, true);
    assert.equal(existsSync(join(workspaceRoot, "wks_toolfs001")), false);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("workspace lifecycle model reports filesystem failures as structured failures", () => {
  const registry = new WorkspaceRegistry({
    store: new InMemoryWorkspaceStore(),
    filesystem: {
      createWorkspaceDirectory: () => {
        throw new Error("no writable workspace root");
      },
      deleteWorkspaceDirectory: () => undefined,
    },
    clock: () => new Date("2026-07-02T12:00:00.000Z"),
    createId: () => "wks_toolfsfail001",
  });

  const response = buildCreateWorkspaceResult(registry, {});

  assert.equal(response.ok, false);
  assert.equal(response.error.code, WORKSPACE_LIFECYCLE_ERROR_CODES.filesystemUnavailable);
  assert.equal(createWorkspaceOutputSchema.safeParse(response).success, true);
});
