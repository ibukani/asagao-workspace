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
  workspaceSourceSchema,
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
  internetPolicy: "package_registry",
  source: {
    type: "git",
    repoUrl: "https://github.com/example/project.git",
    branch: "main",
    baseRef: "origin/main",
  },
  baseCommit: "abc123",
  currentCommit: "def456",
  defaultBranch: "main",
  workingBranch: "asagao/workspace-alpha",
};

test("domain schemas accept valid workspace runner models", () => {
  assert.deepEqual(workspaceSchema.parse(validWorkspace), validWorkspace);

  assert.equal(
    commandJobSchema.parse({
      jobId: "job_alpha123",
      workspaceId: "wks_alpha123",
      status: "succeeded",
      command: ["npm", "test"],
      cwd: ".",
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      finishedAt: now,
      timeoutMs: 120_000,
      elapsedMs: 0,
      exitCode: 0,
      signal: null,
      failureKind: null,
      stdout: "",
      stderr: "",
      stdoutBytes: 0,
      stderrBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
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
      baseCommit: "abc123",
      changedFiles: [
        {
          path: "src/index.ts",
          status: "modified",
          additions: 12,
          deletions: 3,
        },
      ],
      diffstat: {
        filesChanged: 1,
        additions: 12,
        deletions: 3,
      },
      patchArtifactId: "art_alpha123",
      testEvidence: [
        {
          jobId: "job_alpha123",
          name: "npm test",
          status: "passed",
          summary: "All tests passed",
        },
      ],
      generatedArtifacts: [
        {
          artifactId: "art_alpha123",
          name: "workspace.diff",
        },
      ],
      suggestedCommitMessage: "Add workspace contracts",
      suggestedPullRequestBody: "## Summary\n- Add contracts",
      riskLevel: "low",
    }).status,
    "ready",
  );
});

test("workspace source is a discriminated union with source-specific invariants", () => {
  assert.deepEqual(workspaceSourceSchema.parse({ type: "empty" }), { type: "empty" });
  assert.equal(
    workspaceSourceSchema.safeParse({
      type: "git",
      repoUrl: "https://github.com/example/project.git",
    }).success,
    true,
  );

  assert.equal(workspaceSourceSchema.safeParse({ type: "git" }).success, false);
  assert.equal(
    workspaceSourceSchema.safeParse({
      type: "empty",
      repoUrl: "https://github.com/example/project.git",
    }).success,
    false,
  );
  assert.equal(workspaceSourceSchema.safeParse({ type: "empty", branch: "main" }).success, false);
});

test("domain schemas reject invalid enum values and ids", () => {
  assert.equal(workspaceSchema.safeParse({ ...validWorkspace, status: "running" }).success, false);
  assert.equal(workspaceSchema.safeParse({ ...validWorkspace, runtimeProfile: "deno" }).success, false);
  assert.equal(workspaceSchema.safeParse({ ...validWorkspace, internetPolicy: "open" }).success, false);
  assert.equal(workspaceSchema.safeParse({ ...validWorkspace, workspaceId: "workspace-1" }).success, false);
  assert.equal(commandJobSchema.safeParse({
    jobId: "job_alpha123",
    workspaceId: "wks_alpha123",
    status: "done",
    command: ["npm", "test"],
    cwd: ".",
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    timeoutMs: 120_000,
    elapsedMs: null,
    exitCode: null,
    signal: null,
    failureKind: null,
    stdout: "",
    stderr: "",
    stdoutBytes: 0,
    stderrBytes: 0,
    stdoutTruncated: false,
    stderrTruncated: false,
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
