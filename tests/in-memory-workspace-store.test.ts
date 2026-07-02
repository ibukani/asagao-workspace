import test from "node:test";
import assert from "node:assert/strict";
import { createWorkspaceModel, markWorkspaceDeleted } from "../src/domain/index.ts";
import { InMemoryWorkspaceStore } from "../src/storage/in-memory-workspace-store.ts";

const now = new Date("2026-07-02T12:00:00.000Z");

function workspace(workspaceId: string, overrides = {}) {
  return createWorkspaceModel(
    {
      workspaceId,
      name: workspaceId,
      ...overrides,
    },
    { now },
  );
}

test("InMemoryWorkspaceStore saves, gets, and lists workspace records", () => {
  const store = new InMemoryWorkspaceStore();
  const first = workspace("wks_store001");
  const second = workspace("wks_store002", { runtimeProfile: "node" });

  assert.equal(store.save(first), first);
  assert.equal(store.save(second), second);

  assert.deepEqual(store.get("wks_store001"), first);
  assert.equal(store.get("wks_missing001"), null);
  assert.deepEqual(store.list(), [first, second]);
});

test("InMemoryWorkspaceStore hides deleted workspaces unless explicitly included", () => {
  const store = new InMemoryWorkspaceStore();
  const ready = workspace("wks_ready001");
  const deleted = markWorkspaceDeleted(workspace("wks_deleted001"), {
    deletedAt: new Date("2026-07-02T12:30:00.000Z"),
  });

  store.save(ready);
  store.save(deleted);

  assert.deepEqual(store.list(), [ready]);
  assert.deepEqual(store.list({ includeDeleted: true }), [ready, deleted]);
  assert.deepEqual(store.get("wks_deleted001"), deleted);
});

test("InMemoryWorkspaceStore filters by status and runtime profile", () => {
  const store = new InMemoryWorkspaceStore();
  const nodeWorkspace = workspace("wks_node001", { runtimeProfile: "node" });
  const pythonWorkspace = workspace("wks_python001", { runtimeProfile: "python" });
  const failedWorkspace = workspace("wks_failed001", { status: "failed" });

  store.save(nodeWorkspace);
  store.save(pythonWorkspace);
  store.save(failedWorkspace);

  assert.deepEqual(store.list({ runtimeProfile: ["node"] }), [nodeWorkspace]);
  assert.deepEqual(store.list({ status: ["failed"] }), [failedWorkspace]);
  assert.deepEqual(
    store.list({ status: ["ready"], runtimeProfile: ["python"] }),
    [pythonWorkspace],
  );
});

test("InMemoryWorkspaceStore can be cleared between tests or process resets", () => {
  const store = new InMemoryWorkspaceStore();
  store.save(workspace("wks_clear001"));

  store.clear();

  assert.deepEqual(store.list({ includeDeleted: true }), []);
});
