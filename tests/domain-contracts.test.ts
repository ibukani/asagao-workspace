import test from "node:test";
import assert from "node:assert/strict";
import {
  artifactSchema,
  changeSetSchema,
  commandJobSchema,
  createToolResponseSchema,
  toolError,
  toolSuccess,
  workspaceSchema,
  snapshotSchema,
} from "../src/domain/index.ts";

const now = "2026-07-02T12:00:00.000Z";

const validWorkspace = {
  workspaceId: "wks_alpha123",
  name: "Alpha workspace",
  status: "ready",
  createdAt: now,
  updatedAt: now,
  expiresAt: "2026-07-02T13:00:00.000Z",
  runtimeProfile: "node",
  source: {
    type: "git",
    repoUrl: "https://github.com/example/project.git",
    branch: "main",
    baseRef: "origin/main",
  },
};

test("domain schemas accept valid workspace runner models", () => {
  assert.deepEqual(workspaceSchema.parse(validWorkspace), validWorkspace);

  assert.equal(
    commandJobSchema.parse({
      jobId: "job_alpha123",
      workspaceId: "wks_alpha123",
      status: "succeeded",
      command: ["npm", "test"],
      createdAt: now,
      updatedAt: now,
      exitCode: 0,
    }).status,
    "succeeded",
  );

  assert.equal(
    artifactSchema.parse({
      artifactId: "art_alpha123",
      workspaceId: "wks_alpha123",
      kind: "diff",
      name: "workspace.diff",
      createdAt: now,
    }).kind,
    "diff",
  );

  assert.equal(
    snapshotSchema.parse({
      snapshotId: "snp_alpha123",
      workspaceId: "wks_alpha123",
      createdAt: now,
      label: "before install",
    }).label,
    "before install",
  );

  assert.equal(
    changeSetSchema.parse({
      changeSetId: "chg_alpha123",
      workspaceId: "wks_alpha123",
      status: "ready",
      createdAt: now,
      updatedAt: now,
    }).status,
    "ready",
  );
});

test("domain schemas reject invalid enum values and ids", () => {
  assert.equal(workspaceSchema.safeParse({ ...validWorkspace, status: "running" }).success, false);
  assert.equal(workspaceSchema.safeParse({ ...validWorkspace, runtimeProfile: "deno" }).success, false);
  assert.equal(workspaceSchema.safeParse({ ...validWorkspace, workspaceId: "workspace-1" }).success, false);
  assert.equal(commandJobSchema.safeParse({
    jobId: "job_alpha123",
    workspaceId: "wks_alpha123",
    status: "done",
    command: ["npm", "test"],
    createdAt: now,
    updatedAt: now,
  }).success, false);
});

test("tool response helpers return the stable success and error shape", () => {
  const responseSchema = createToolResponseSchema(workspaceSchema);
  const success = toolSuccess(validWorkspace);
  const failure = toolError("workspace_not_found", "Workspace not found", {
    workspaceId: "wks_missing123",
  });

  assert.deepEqual(success, { ok: true, data: validWorkspace });
  assert.deepEqual(failure, {
    ok: false,
    error: {
      code: "workspace_not_found",
      message: "Workspace not found",
      details: { workspaceId: "wks_missing123" },
    },
  });
  assert.equal(responseSchema.safeParse(success).success, true);
  assert.equal(responseSchema.safeParse(failure).success, true);
});
