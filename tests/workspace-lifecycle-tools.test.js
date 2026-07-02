import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceRegistry } from "../src/services/workspace-registry.js";
import { InMemoryWorkspaceStore } from "../src/storage/in-memory-workspace-store.js";
import {
  buildCreateWorkspaceResult,
  buildDeleteWorkspaceResult,
  buildGetWorkspaceResult,
  buildListWorkspacesResult,
} from "../src/tools/workspace-lifecycle/model.js";

const NOW = new Date("2026-07-02T00:00:00.000Z");
const LATER = new Date("2026-07-02T01:00:00.000Z");

function createRegistry() {
  let counter = 0;
  return new WorkspaceRegistry({
    store: new InMemoryWorkspaceStore(),
    clock: () => NOW,
    createId: () => `ws_${++counter}`,
  });
}

test("workspace lifecycle model creates and lists workspaces", () => {
  const registry = createRegistry();
  const created = buildCreateWorkspaceResult(registry, {
    workspaceName: "asagao",
    runtimeProfile: "node",
  });
  const listed = buildListWorkspacesResult(registry, {});

  assert.equal(created.ok, true);
  assert.equal(created.result.workspace.workspaceId, "ws_1");
  assert.equal(created.result.workspace.status, "ready");
  assert.equal(created.result.workspace.workspaceName, "asagao");
  assert.deepEqual(listed.result.workspaces, [created.result.workspace]);
});

test("workspace lifecycle model gets and deletes workspaces", () => {
  const registry = createRegistry();
  const created = buildCreateWorkspaceResult(registry, {});
  const workspaceId = created.result.workspace.workspaceId;

  const found = buildGetWorkspaceResult(registry, { workspaceId });
  assert.equal(found.ok, true);
  assert.equal(found.result.workspace.workspaceId, workspaceId);

  registry.clock = () => LATER;
  const deleted = buildDeleteWorkspaceResult(registry, { workspaceId });
  assert.equal(deleted.ok, true);
  assert.equal(deleted.result.workspace.status, "deleted");
  assert.equal(deleted.result.workspace.deletedAt, "2026-07-02T01:00:00.000Z");

  const activeList = buildListWorkspacesResult(registry, {});
  const fullList = buildListWorkspacesResult(registry, { includeDeleted: true });
  assert.deepEqual(activeList.result.workspaces, []);
  assert.deepEqual(fullList.result.workspaces, [deleted.result.workspace]);
});

test("workspace lifecycle model returns structured errors", () => {
  const registry = createRegistry();
  const invalid = buildCreateWorkspaceResult(registry, { ttlMinutes: -1 });
  const missing = buildGetWorkspaceResult(registry, { workspaceId: "missing" });

  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, "invalid_input");
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "not_found");
  assert.deepEqual(missing.error.details, { workspaceId: "missing" });
});
