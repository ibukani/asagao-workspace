import test from "node:test";
import assert from "node:assert/strict";
import { createWorkspaceModel } from "../src/domain/index.ts";
import {
  evaluateWorkspaceLifecycle,
  isWorkspaceExpired,
} from "../src/services/workspace-lifecycle-service.ts";
import { createWorkspaceLifecycleMetadata } from "../src/storage/in-memory-workspace-lifecycle-store.ts";

const now = new Date("2026-07-02T12:00:00.000Z");

function workspace(overrides: Partial<Parameters<typeof createWorkspaceModel>[0]> = {}) {
  return createWorkspaceModel(
    {
      workspaceId: "wks_lifecycle001",
      ttlMinutes: 60,
      ...overrides,
    },
    { now },
  );
}

function metadata() {
  return createWorkspaceLifecycleMetadata("wks_lifecycle001", now);
}

test("workspace lifecycle marks clean ready workspaces as reusable", () => {
  const snapshot = evaluateWorkspaceLifecycle({
    workspace: workspace(),
    metadata: metadata(),
    now,
  });

  assert.equal(snapshot.state, "reusable");
  assert.equal(snapshot.reusable, true);
  assert.equal(snapshot.expired, false);
  assert.equal(snapshot.dirty, false);
  assert.equal(snapshot.busy, false);
  assert.deepEqual(snapshot.blockers, []);
});

test("workspace lifecycle detects TTL expiry without marking the workspace deleted", () => {
  const expiredWorkspace = workspace({ ttlMinutes: 10 });
  const evaluatedAt = new Date("2026-07-02T12:10:00.000Z");
  const snapshot = evaluateWorkspaceLifecycle({
    workspace: expiredWorkspace,
    metadata: metadata(),
    now: evaluatedAt,
  });

  assert.equal(isWorkspaceExpired(expiredWorkspace, evaluatedAt), true);
  assert.equal(snapshot.state, "expired");
  assert.equal(snapshot.expired, true);
  assert.equal(snapshot.reusable, false);
  assert.deepEqual(snapshot.blockers, ["workspace_expired"]);
});

test("workspace lifecycle blocks deleted, failed, dirty, unknown, and busy workspaces", () => {
  const deleted = evaluateWorkspaceLifecycle({
    workspace: workspace({ status: "deleted" }),
    metadata: metadata(),
    now,
  });
  const failed = evaluateWorkspaceLifecycle({
    workspace: workspace({ status: "failed" }),
    metadata: metadata(),
    now,
  });
  const dirtyMetadata = { ...metadata(), dirtyState: "dirty" as const };
  const dirty = evaluateWorkspaceLifecycle({ workspace: workspace(), metadata: dirtyMetadata, now });
  const unknownMetadata = { ...metadata(), dirtyState: "unknown" as const };
  const unknown = evaluateWorkspaceLifecycle({ workspace: workspace(), metadata: unknownMetadata, now });
  const busyMetadata = { ...metadata(), busyState: "busy" as const };
  const busy = evaluateWorkspaceLifecycle({ workspace: workspace(), metadata: busyMetadata, now });

  assert.equal(deleted.state, "deleted");
  assert.deepEqual(deleted.blockers, ["workspace_deleted"]);
  assert.equal(failed.state, "failed");
  assert.deepEqual(failed.blockers, ["workspace_failed"]);
  assert.equal(dirty.state, "dirty");
  assert.deepEqual(dirty.blockers, ["workspace_dirty"]);
  assert.equal(unknown.state, "dirty");
  assert.deepEqual(unknown.blockers, ["dirty_state_unknown"]);
  assert.equal(busy.state, "busy");
  assert.deepEqual(busy.blockers, ["workspace_busy"]);
});
