import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceRegistry } from "../src/services/workspace-registry.js";
import { InMemoryWorkspaceStore } from "../src/storage/in-memory-workspace-store.js";

const NOW = new Date("2026-07-02T00:00:00.000Z");
const LATER = new Date("2026-07-02T01:00:00.000Z");

function createRegistry({ now = NOW } = {}) {
  let counter = 0;
  return new WorkspaceRegistry({
    store: new InMemoryWorkspaceStore(),
    clock: () => now,
    createId: () => `ws_${++counter}`,
  });
}

test("WorkspaceRegistry creates ready in-memory workspace records", () => {
  const registry = createRegistry();
  const workspace = registry.createWorkspace({
    repoUrl: "https://github.com/ibukani/asagao-workspace.git",
    branch: "main",
    baseRef: "HEAD",
    workspaceName: "asagao",
    runtimeProfile: "node",
    internetPolicy: "package_registry",
    ttlMinutes: 60,
  });

  assert.equal(workspace.workspaceId, "ws_1");
  assert.equal(workspace.status, "ready");
  assert.equal(workspace.workspaceName, "asagao");
  assert.equal(workspace.runtimeProfile, "node");
  assert.equal(workspace.internetPolicy, "package_registry");
  assert.equal(workspace.expiresAt, "2026-07-02T01:00:00.000Z");
  assert.deepEqual(workspace.source, {
    type: "git",
    repoUrl: "https://github.com/ibukani/asagao-workspace.git",
    branch: "main",
    baseRef: "HEAD",
  });
});

test("WorkspaceRegistry lists, gets, and marks workspaces as deleted", () => {
  const registry = createRegistry();
  const workspace = registry.createWorkspace({ workspaceName: "demo" });

  assert.deepEqual(registry.listWorkspaces(), [workspace]);
  assert.equal(registry.getWorkspace("ws_1"), workspace);

  registry.clock = () => LATER;
  const deleted = registry.deleteWorkspace("ws_1");

  assert.equal(deleted.status, "deleted");
  assert.equal(deleted.deletedAt, "2026-07-02T01:00:00.000Z");
  assert.deepEqual(registry.listWorkspaces(), []);
  assert.deepEqual(registry.listWorkspaces({ includeDeleted: true }), [deleted]);
  assert.equal(registry.getWorkspace("missing"), null);
  assert.equal(registry.deleteWorkspace("missing"), null);
});
