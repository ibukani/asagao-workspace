import test from "node:test";
import assert from "node:assert/strict";
import {
  InMemoryAuditEventRecorder,
  createRunnerSecurityServices,
} from "../src/security/index.ts";
import { WorkspaceLifecycleService } from "../src/services/workspace-lifecycle-service.ts";
import { WorkspaceRegistry } from "../src/services/workspace-registry.ts";
import { InMemoryWorkspaceLifecycleStore } from "../src/storage/in-memory-workspace-lifecycle-store.ts";
import { InMemoryWorkspaceStore } from "../src/storage/in-memory-workspace-store.ts";

function createFixture() {
  const auditRecorder = new InMemoryAuditEventRecorder();
  let now = new Date("2026-07-02T12:00:00.000Z");
  const registry = new WorkspaceRegistry({
    store: new InMemoryWorkspaceStore(),
    clock: () => now,
    createId: () => "wks_service001",
  });
  const lifecycleStore = new InMemoryWorkspaceLifecycleStore();
  const service = new WorkspaceLifecycleService({
    workspaceRegistry: registry,
    lifecycleStore,
    security: createRunnerSecurityServices({ auditRecorder }),
    clock: () => now,
  });

  return {
    auditRecorder,
    registry,
    lifecycleStore,
    service,
    advanceTo: (value: string) => {
      now = new Date(value);
    },
  };
}

test("WorkspaceLifecycleService returns lifecycle snapshots for registry workspaces", () => {
  const { registry, service } = createFixture();
  const workspace = registry.createWorkspace({ ttlMinutes: 30 });

  const record = service.getWorkspaceLifecycle(workspace.workspaceId);

  assert.equal(record?.workspace.workspaceId, "wks_service001");
  assert.equal(record?.lifecycle.state, "reusable");
  assert.equal(record?.lifecycle.reusable, true);
  assert.equal(service.getWorkspaceLifecycle("wks_missing001"), null);
});

test("WorkspaceLifecycleService exposes dirty and busy marker boundaries", () => {
  const { registry, service } = createFixture();
  const workspace = registry.createWorkspace({});

  assert.equal(service.markDirty(workspace.workspaceId)?.state, "dirty");
  assert.deepEqual(service.markDirty(workspace.workspaceId)?.blockers, ["workspace_dirty"]);
  assert.equal(service.markClean(workspace.workspaceId)?.state, "reusable");
  assert.equal(service.markBusy(workspace.workspaceId)?.state, "busy");
  assert.deepEqual(service.markBusy(workspace.workspaceId)?.blockers, ["workspace_busy"]);
  assert.equal(service.markIdle(workspace.workspaceId)?.state, "reusable");
  assert.deepEqual(service.markDirtyUnknown(workspace.workspaceId)?.blockers, ["dirty_state_unknown"]);
});

test("claimWorkspace accepts only reusable workspaces and records audit events", async () => {
  const { auditRecorder, registry, service, advanceTo } = createFixture();
  const workspace = registry.createWorkspace({});
  advanceTo("2026-07-02T12:05:00.000Z");

  const claimed = await service.claimWorkspace({ workspaceId: workspace.workspaceId });

  assert.equal(claimed?.accepted, true);
  assert.equal(claimed?.implemented, true);
  assert.equal(claimed?.lifecycle.lastClaimedAt, "2026-07-02T12:05:00.000Z");
  assert.deepEqual(
    auditRecorder.listEvents().map((event) => event.eventType),
    ["policy_evaluated", "operation_started", "operation_succeeded"],
  );

  service.markBusy(workspace.workspaceId);
  const denied = await service.claimWorkspace({ workspaceId: workspace.workspaceId });

  assert.equal(denied?.accepted, false);
  assert.deepEqual(denied?.blockers, ["workspace_busy"]);
  assert.equal(auditRecorder.listEvents().at(-1)?.eventType, "operation_denied");
  assert.deepEqual(auditRecorder.listEvents().at(-1)?.metadata, {
    phase: "phase1",
    lifecycleState: "busy",
    blockers: ["workspace_busy"],
    implemented: true,
  });
});

test("resetWorkspace and cleanWorkspace are audited Phase 1 service boundaries without filesystem side effects", async () => {
  const { auditRecorder, registry, service } = createFixture();
  const workspace = registry.createWorkspace({});

  const reset = await service.resetWorkspace({ workspaceId: workspace.workspaceId });
  const clean = await service.cleanWorkspace({ workspaceId: workspace.workspaceId });

  assert.equal(reset?.accepted, false);
  assert.equal(reset?.implemented, false);
  assert.deepEqual(reset?.blockers, ["operation_not_implemented_in_phase1"]);
  assert.equal(clean?.accepted, false);
  assert.equal(clean?.implemented, false);
  assert.deepEqual(clean?.blockers, ["operation_not_implemented_in_phase1"]);
  assert.deepEqual(
    auditRecorder.listEvents().map((event) => [event.action, event.eventType]),
    [
      ["reset_workspace", "policy_evaluated"],
      ["reset_workspace", "operation_denied"],
      ["clean_workspace", "policy_evaluated"],
      ["clean_workspace", "operation_denied"],
    ],
  );
});

test("expired workspaces cannot be claimed", async () => {
  const { registry, service, advanceTo } = createFixture();
  const workspace = registry.createWorkspace({ ttlMinutes: 1 });
  advanceTo("2026-07-02T12:01:00.000Z");

  const result = await service.claimWorkspace({ workspaceId: workspace.workspaceId });

  assert.equal(result?.accepted, false);
  assert.equal(result?.lifecycle.state, "expired");
  assert.deepEqual(result?.blockers, ["workspace_expired"]);
});
