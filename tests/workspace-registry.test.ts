import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceRegistry } from "../src/services/workspace-registry.ts";
import { InMemoryWorkspaceStore } from "../src/storage/in-memory-workspace-store.ts";

const createdAt = new Date("2026-07-02T12:00:00.000Z");
const deletedAt = new Date("2026-07-02T12:20:00.000Z");

function registryWithClock(now = createdAt) {
  const store = new InMemoryWorkspaceStore();
  const registry = new WorkspaceRegistry({
    store,
    clock: () => now,
    createId: () => "wks_registry001",
  });

  return { registry, store };
}

test("WorkspaceRegistry creates a ready empty workspace with defaults", () => {
  const { registry } = registryWithClock();
  const workspace = registry.createWorkspace({});

  assert.equal(workspace.workspaceId, "wks_registry001");
  assert.equal(workspace.name, "Workspace wks_registry001");
  assert.equal(workspace.status, "ready");
  assert.equal(workspace.runtimeProfile, "generic");
  assert.equal(workspace.internetPolicy, "none");
  assert.deepEqual(workspace.source, { type: "empty" });
  assert.equal(workspace.createdAt, "2026-07-02T12:00:00.000Z");
  assert.equal(workspace.updatedAt, "2026-07-02T12:00:00.000Z");
  assert.equal(workspace.expiresAt, null);
  assert.equal(workspace.defaultBranch, null);
  assert.equal(workspace.workingBranch, null);
});

test("WorkspaceRegistry creates git workspaces with TTL and source metadata", () => {
  const { registry } = registryWithClock();
  const workspace = registry.createWorkspace({
    repoUrl: "https://github.com/example/project.git",
    branch: "main",
    baseRef: "origin/main",
    workspaceName: "Example project",
    runtimeProfile: "node",
    internetPolicy: "package_registry",
    ttlMinutes: 90,
  });

  assert.equal(workspace.name, "Example project");
  assert.deepEqual(workspace.source, {
    type: "git",
    repoUrl: "https://github.com/example/project.git",
    branch: "main",
    baseRef: "origin/main",
  });
  assert.equal(workspace.runtimeProfile, "node");
  assert.equal(workspace.internetPolicy, "package_registry");
  assert.equal(workspace.expiresAt, "2026-07-02T13:30:00.000Z");
  assert.equal(workspace.defaultBranch, "main");
  assert.equal(workspace.workingBranch, "main");
});

test("WorkspaceRegistry lists and filters stored workspaces", () => {
  let sequence = 0;
  const store = new InMemoryWorkspaceStore();
  const registry = new WorkspaceRegistry({
    store,
    clock: () => createdAt,
    createId: () => `wks_list00${++sequence}`,
  });

  const first = registry.createWorkspace({ runtimeProfile: "node" });
  const second = registry.createWorkspace({ runtimeProfile: "python" });

  assert.deepEqual(registry.listWorkspaces(), [first, second]);
  assert.deepEqual(registry.listWorkspaces({ runtimeProfile: ["python"] }), [second]);
});

test("WorkspaceRegistry updates workspace status through the allowed lifecycle states", () => {
  const store = new InMemoryWorkspaceStore();
  const registry = new WorkspaceRegistry({
    store,
    clock: () => createdAt,
    createId: () => "wks_status001",
  });
  const workspace = registry.createWorkspace({});

  const failingRegistry = new WorkspaceRegistry({
    store,
    clock: () => deletedAt,
    createId: () => "wks_unused001",
  });
  const creating = failingRegistry.setWorkspaceStatus(workspace.workspaceId, "creating");
  const readyAgain = failingRegistry.setWorkspaceStatus(workspace.workspaceId, "ready");
  const failed = failingRegistry.setWorkspaceStatus(workspace.workspaceId, "failed");

  assert.equal(creating?.status, "creating");
  assert.equal(readyAgain?.status, "ready");
  assert.equal(failed?.workspaceId, workspace.workspaceId);
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.createdAt, "2026-07-02T12:00:00.000Z");
  assert.equal(failed?.updatedAt, "2026-07-02T12:20:00.000Z");
  assert.deepEqual(failingRegistry.listWorkspaces({ status: ["failed"] }), [failed]);
  assert.equal(failingRegistry.setWorkspaceStatus("wks_unknown001", "ready"), null);
});

test("WorkspaceRegistry marks a workspace as deleted without removing the record", () => {
  const store = new InMemoryWorkspaceStore();
  const registry = new WorkspaceRegistry({
    store,
    clock: () => createdAt,
    createId: () => "wks_delete001",
  });
  const workspace = registry.createWorkspace({});

  const deletingRegistry = new WorkspaceRegistry({
    store,
    clock: () => deletedAt,
    createId: () => "wks_unused001",
  });
  const deleted = deletingRegistry.deleteWorkspace(workspace.workspaceId);

  assert.equal(deleted?.workspaceId, workspace.workspaceId);
  assert.equal(deleted?.status, "deleted");
  assert.equal(deleted?.createdAt, "2026-07-02T12:00:00.000Z");
  assert.equal(deleted?.updatedAt, "2026-07-02T12:20:00.000Z");
  assert.deepEqual(deletingRegistry.listWorkspaces(), []);
  assert.deepEqual(deletingRegistry.listWorkspaces({ includeDeleted: true }), [deleted]);
  assert.deepEqual(deletingRegistry.getWorkspace(workspace.workspaceId), deleted);
});

test("WorkspaceRegistry delete is idempotent and returns null for unknown ids", () => {
  const { registry } = registryWithClock();
  const workspace = registry.createWorkspace({});
  const firstDelete = registry.deleteWorkspace(workspace.workspaceId);
  const secondDelete = registry.deleteWorkspace(workspace.workspaceId);

  assert.deepEqual(secondDelete, firstDelete);
  assert.equal(registry.deleteWorkspace("wks_unknown001"), null);
});

test("WorkspaceRegistry creates local filesystem directories when configured", () => {
  const calls: string[] = [];
  const registry = new WorkspaceRegistry({
    store: new InMemoryWorkspaceStore(),
    filesystem: {
      createWorkspaceDirectory: (workspaceId) => calls.push(`create:${workspaceId}`),
      deleteWorkspaceDirectory: (workspaceId) => calls.push(`delete:${workspaceId}`),
    },
    clock: () => createdAt,
    createId: () => "wks_filesystem001",
  });

  const workspace = registry.createWorkspace({});

  assert.equal(workspace.status, "ready");
  assert.deepEqual(calls, ["create:wks_filesystem001"]);
});

test("WorkspaceRegistry records failed status when filesystem create fails", () => {
  const store = new InMemoryWorkspaceStore();
  const registry = new WorkspaceRegistry({
    store,
    filesystem: {
      createWorkspaceDirectory: () => {
        throw new Error("disk unavailable");
      },
      deleteWorkspaceDirectory: () => undefined,
    },
    clock: () => createdAt,
    createId: () => "wks_fail001",
  });

  assert.throws(() => registry.createWorkspace({}), /Failed to create local filesystem workspace/);
  assert.equal(store.get("wks_fail001")?.status, "failed");
});

test("WorkspaceRegistry deletes local filesystem directories before marking records deleted", () => {
  const calls: string[] = [];
  const store = new InMemoryWorkspaceStore();
  const registry = new WorkspaceRegistry({
    store,
    filesystem: {
      createWorkspaceDirectory: (workspaceId) => calls.push(`create:${workspaceId}`),
      deleteWorkspaceDirectory: (workspaceId) => calls.push(`delete:${workspaceId}`),
    },
    clock: () => createdAt,
    createId: () => "wks_deletefs001",
  });
  const workspace = registry.createWorkspace({});

  const deletingRegistry = new WorkspaceRegistry({
    store,
    filesystem: {
      createWorkspaceDirectory: (workspaceId) => calls.push(`create:${workspaceId}`),
      deleteWorkspaceDirectory: (workspaceId) => calls.push(`delete:${workspaceId}`),
    },
    clock: () => deletedAt,
    createId: () => "wks_unused001",
  });
  const deleted = deletingRegistry.deleteWorkspace(workspace.workspaceId);

  assert.equal(deleted?.status, "deleted");
  assert.deepEqual(calls, ["create:wks_deletefs001", "delete:wks_deletefs001"]);
});

test("WorkspaceRegistry keeps records undeleted when filesystem delete fails", () => {
  const store = new InMemoryWorkspaceStore();
  const registry = new WorkspaceRegistry({
    store,
    filesystem: {
      createWorkspaceDirectory: () => undefined,
      deleteWorkspaceDirectory: () => {
        throw new Error("remove failed");
      },
    },
    clock: () => createdAt,
    createId: () => "wks_deletefail001",
  });
  const workspace = registry.createWorkspace({});

  assert.throws(
    () => registry.deleteWorkspace(workspace.workspaceId),
    /Failed to delete local filesystem workspace/,
  );
  assert.equal(store.get(workspace.workspaceId)?.status, "ready");
});
