import test from "node:test";
import assert from "node:assert/strict";
import { createWorkspaceModel } from "../src/domain/index.js";
import { InMemoryWorkspaceStore } from "../src/storage/in-memory-workspace-store.js";

const NOW = new Date("2026-07-02T00:00:00.000Z");

test("InMemoryWorkspaceStore saves, gets, and lists active workspaces", () => {
  const store = new InMemoryWorkspaceStore();
  const workspace = createWorkspaceModel(
    { workspaceId: "ws_1", status: "ready" },
    { now: NOW },
  );

  store.save(workspace);

  assert.equal(store.get("ws_1"), workspace);
  assert.deepEqual(store.list(), [workspace]);
});

test("InMemoryWorkspaceStore hides deleted workspaces unless requested", () => {
  const store = new InMemoryWorkspaceStore();
  const active = createWorkspaceModel(
    { workspaceId: "ws_active", status: "ready" },
    { now: NOW },
  );
  const deleted = createWorkspaceModel(
    {
      workspaceId: "ws_deleted",
      status: "deleted",
      deletedAt: "2026-07-02T01:00:00.000Z",
    },
    { now: NOW },
  );

  store.save(active);
  store.save(deleted);

  assert.deepEqual(store.list(), [active]);
  assert.deepEqual(store.list({ includeDeleted: true }), [active, deleted]);
});
