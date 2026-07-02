import test from "node:test";
import assert from "node:assert/strict";
import {
  COMMON_ERROR_CODES,
  createArtifactRefModel,
  createChangeSetModel,
  createCommandJobModel,
  createSnapshotModel,
  createToolError,
  createToolSuccess,
  createWorkspaceModel,
  markWorkspaceDeleted,
  markWorkspaceFailed,
  markWorkspaceReady,
} from "../src/domain/index.js";

const NOW = new Date("2026-07-02T00:00:00.000Z");

test("createWorkspaceModel returns a stable workspace shape", () => {
  const workspace = createWorkspaceModel(
    {
      workspaceId: "ws_1",
      workspaceName: "demo",
      runtimeProfile: "node",
      internetPolicy: "package_registry",
      ttlMinutes: 30,
    },
    { now: NOW },
  );

  assert.equal(workspace.workspaceId, "ws_1");
  assert.equal(workspace.workspaceName, "demo");
  assert.equal(workspace.status, "creating");
  assert.equal(workspace.runtimeProfile, "node");
  assert.equal(workspace.internetPolicy, "package_registry");
  assert.equal(workspace.createdAt, "2026-07-02T00:00:00.000Z");
  assert.equal(workspace.expiresAt, "2026-07-02T00:30:00.000Z");
  assert.equal(workspace.source, null);
});

test("workspace status transition helpers preserve stable fields", () => {
  const workspace = createWorkspaceModel({ workspaceId: "ws_1" }, { now: NOW });
  const ready = markWorkspaceReady(workspace, { currentCommit: "abc123" });
  const failed = markWorkspaceFailed(ready, "validation failed");
  const deleted = markWorkspaceDeleted(failed, {
    deletedAt: "2026-07-02T01:00:00.000Z",
  });

  assert.equal(ready.status, "ready");
  assert.equal(ready.currentCommit, "abc123");
  assert.equal(failed.status, "failed");
  assert.equal(failed.failureReason, "validation failed");
  assert.equal(deleted.status, "deleted");
  assert.equal(deleted.deletedAt, "2026-07-02T01:00:00.000Z");
});

test("createCommandJobModel requires an argv-style command", () => {
  const job = createCommandJobModel(
    {
      jobId: "job_1",
      workspaceId: "ws_1",
      command: ["node", "--version"],
      timeoutMs: 60_000,
    },
    { now: NOW },
  );

  assert.equal(job.status, "queued");
  assert.deepEqual(job.command, ["node", "--version"]);
  assert.equal(job.createdAt, "2026-07-02T00:00:00.000Z");
  assert.throws(
    () => createCommandJobModel({ jobId: "job_2", workspaceId: "ws_1", command: [] }),
    /command must contain at least one argument/,
  );
});

test("artifact, snapshot, and change set models keep structured metadata", () => {
  const artifact = createArtifactRefModel(
    {
      artifactId: "artifact_1",
      workspaceId: "ws_1",
      kind: "patch",
      name: "change.patch",
      sizeBytes: 42,
    },
    { now: NOW },
  );
  const snapshot = createSnapshotModel(
    { snapshotId: "snap_1", workspaceId: "ws_1", label: "before patch" },
    { now: NOW },
  );
  const changeSet = createChangeSetModel({
    changeSetId: "cs_1",
    workspaceId: "ws_1",
    changedFiles: [{ path: "src/index.js", additions: 3 }],
    diffstat: { filesChanged: 1, insertions: 3, deletions: 0 },
    patchArtifactId: artifact.artifactId,
    generatedArtifacts: [artifact],
    riskLevel: "low",
  });

  assert.equal(artifact.kind, "patch");
  assert.equal(snapshot.label, "before patch");
  assert.equal(changeSet.changedFiles[0].status, "modified");
  assert.deepEqual(changeSet.diffstat, {
    filesChanged: 1,
    insertions: 3,
    deletions: 0,
  });
});

test("tool result helpers expose a common success and error envelope", () => {
  const success = createToolSuccess({ result: { workspaceId: "ws_1" } });
  const error = createToolError({
    code: COMMON_ERROR_CODES.NOT_FOUND,
    message: "Workspace not found",
  });

  assert.equal(success.ok, true);
  assert.equal(success.error, null);
  assert.deepEqual(success.warnings, []);
  assert.equal(error.ok, false);
  assert.equal(error.error.code, "not_found");
  assert.equal(error.error.message, "Workspace not found");
});
