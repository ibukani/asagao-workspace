import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryAuditEventRecorder } from "../src/security/audit.ts";
import { createRunnerSecurityServices } from "../src/security/index.ts";
import { LocalWorkspaceFilesystem } from "../src/services/local-workspace-filesystem.ts";
import { WorkspaceLifecycleService } from "../src/services/workspace-lifecycle-service.ts";
import { WorkspacePatchService } from "../src/services/workspace-patch-service.ts";
import { WorkspaceRegistry } from "../src/services/workspace-registry.ts";
import { InMemoryWorkspaceLifecycleStore } from "../src/storage/in-memory-workspace-lifecycle-store.ts";
import { InMemoryWorkspaceStore } from "../src/storage/in-memory-workspace-store.ts";

function createFixture() {
  const parent = mkdtempSync(join(tmpdir(), "asagao-patch-service-"));
  const workspaceRoot = join(parent, "workspaces");
  const filesystem = new LocalWorkspaceFilesystem({ workspaceRoot });
  const registry = new WorkspaceRegistry({
    store: new InMemoryWorkspaceStore(),
    filesystem,
    clock: () => new Date("2026-07-03T12:00:00.000Z"),
    createId: () => "wks_patchservice001",
  });
  const workspace = registry.createWorkspace({ workspaceName: "Patch workspace" });
  const workspaceDirectory = join(workspaceRoot, workspace.workspaceId);
  const auditRecorder = new InMemoryAuditEventRecorder();
  const lifecycleStore = new InMemoryWorkspaceLifecycleStore();
  const security = createRunnerSecurityServices({ auditRecorder });
  const lifecycleService = new WorkspaceLifecycleService({
    workspaceRegistry: registry,
    lifecycleStore,
    security,
    clock: () => new Date("2026-07-03T12:00:00.000Z"),
  });
  const service = new WorkspacePatchService({
    workspaceRegistry: registry,
    workspaceFilesystem: filesystem,
    security,
    workspaceLifecycleService: lifecycleService,
    clock: () => new Date("2026-07-03T12:00:00.000Z"),
    createPatchId: () => "pat_service001",
  });

  return {
    parent,
    workspace,
    workspaceDirectory,
    auditRecorder,
    lifecycleService,
    service,
  };
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8" });
}

function initGitRepository(workspaceDirectory: string): string {
  git(workspaceDirectory, ["init", "-q"]);
  git(workspaceDirectory, ["config", "user.email", "test@example.com"]);
  git(workspaceDirectory, ["config", "user.name", "Test User"]);
  writeFileSync(join(workspaceDirectory, "README.md"), "hello\n");
  git(workspaceDirectory, ["add", "."]);
  git(workspaceDirectory, ["commit", "-m", "initial"]);
  return git(workspaceDirectory, ["rev-parse", "HEAD"]).trim();
}

function readmePatch(): string {
  return [
    "diff --git a/README.md b/README.md",
    "--- a/README.md",
    "+++ b/README.md",
    "@@ -1 +1,2 @@",
    " hello",
    "+patched",
    "",
  ].join("\n");
}

function newFilePatch(path: string): string {
  return unsafeNewFilePatch(path);
}

function unsafeNewFilePatch(path: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "index 0000000..257cc56",
    "--- /dev/null",
    `+++ b/${path}`,
    "@@ -0,0 +1 @@",
    "+created",
    "",
  ].join("\n");
}

test("WorkspacePatchService applies a valid patch through git apply and marks lifecycle dirty", async () => {
  const fixture = createFixture();
  try {
    const head = initGitRepository(fixture.workspaceDirectory);

    const result = await fixture.service.applyPatch({
      workspaceId: fixture.workspace.workspaceId,
      expectedBaseCommit: head,
      patch: readmePatch(),
    });

    assert.equal(result.patchId, "pat_service001");
    assert.equal(result.applied, true);
    assert.deepEqual(result.checkedFiles, ["README.md"]);
    assert.equal(result.diffstat.filesChanged, 1);
    assert.equal(result.diffstat.additions, 1);
    assert.equal(result.gitStatus.clean, false);
    assert.equal(result.changedFiles[0]?.path, "README.md");
    assert.match(readFileSync(join(fixture.workspaceDirectory, "README.md"), "utf8"), /patched/);
    assert.equal(
      fixture.lifecycleService.getWorkspaceLifecycle(fixture.workspace.workspaceId)?.lifecycle.dirtyState,
      "dirty",
    );
    assert.deepEqual(
      fixture.auditRecorder.listEvents().map((event) => event.eventType),
      ["policy_evaluated", "operation_started", "operation_succeeded"],
    );
    assert.equal(JSON.stringify(result).includes(fixture.workspaceDirectory), false);
    assert.equal(JSON.stringify(result).includes(readmePatch()), false);
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});

test("WorkspacePatchService check mode validates without changing files", async () => {
  const fixture = createFixture();
  try {
    initGitRepository(fixture.workspaceDirectory);

    const result = await fixture.service.applyPatch({
      workspaceId: fixture.workspace.workspaceId,
      mode: "check",
      patch: readmePatch(),
    });

    assert.equal(result.applied, false);
    assert.deepEqual(result.checkedFiles, ["README.md"]);
    assert.equal(result.diagnostics[0]?.code, "preflight_succeeded");
    assert.equal(readFileSync(join(fixture.workspaceDirectory, "README.md"), "utf8"), "hello\n");
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});

test("WorkspacePatchService reports broken patches as non-applied structured diagnostics", async () => {
  const fixture = createFixture();
  try {
    initGitRepository(fixture.workspaceDirectory);
    const brokenPatch = readmePatch().replace(" hello", " missing-context");

    const result = await fixture.service.applyPatch({
      workspaceId: fixture.workspace.workspaceId,
      patch: brokenPatch,
    });

    assert.equal(result.applied, false);
    assert.equal(result.diagnostics[0]?.code, "invalid_patch");
    assert.equal(readFileSync(join(fixture.workspaceDirectory, "README.md"), "utf8"), "hello\n");
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});

test("WorkspacePatchService rejects expectedBaseCommit mismatches before applying", async () => {
  const fixture = createFixture();
  try {
    initGitRepository(fixture.workspaceDirectory);

    const result = await fixture.service.applyPatch({
      workspaceId: fixture.workspace.workspaceId,
      expectedBaseCommit: "definitely-not-current",
      patch: readmePatch(),
    });

    assert.equal(result.applied, false);
    assert.equal(result.diagnostics[0]?.code, "base_commit_mismatch");
    assert.equal(readFileSync(join(fixture.workspaceDirectory, "README.md"), "utf8"), "hello\n");
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});


test("WorkspacePatchService reports path traversal, absolute path, and drive prefix patch targets as diagnostics", async () => {
  const fixture = createFixture();
  try {
    initGitRepository(fixture.workspaceDirectory);

    for (const [label, patch] of [
      ["path traversal", unsafeNewFilePatch("../evil.txt")],
      ["absolute path", unsafeNewFilePatch("/tmp/evil.txt")],
      ["drive prefix", unsafeNewFilePatch("C:/evil.txt")],
    ] as const) {
      const result = await fixture.service.applyPatch({
        workspaceId: fixture.workspace.workspaceId,
        patch,
      });

      assert.equal(result.applied, false, label);
      assert.equal(result.diagnostics[0]?.code, "unsafe_path", label);
      assert.equal(JSON.stringify(result).includes(fixture.workspaceDirectory), false, label);
      assert.equal(JSON.stringify(result).includes(patch), false, label);
    }

    assert.equal(existsSync(join(fixture.parent, "evil.txt")), false);
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});

test("WorkspacePatchService rejects denied patch target prefixes", async () => {
  const fixture = createFixture();
  try {
    initGitRepository(fixture.workspaceDirectory);

    const result = await fixture.service.applyPatch({
      workspaceId: fixture.workspace.workspaceId,
      patch: newFilePatch("node_modules/generated.txt"),
    });

    assert.equal(result.applied, false);
    assert.equal(result.diagnostics[0]?.code, "unsafe_path");
    assert.equal(existsSync(join(fixture.workspaceDirectory, "node_modules", "generated.txt")), false);
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});

test("WorkspacePatchService rejects patch targets that traverse existing symlinks outside the workspace", { skip: process.platform === "win32" }, async () => {
  const fixture = createFixture();
  try {
    initGitRepository(fixture.workspaceDirectory);
    const outsideDirectory = join(fixture.parent, "outside");
    mkdirSync(outsideDirectory, { recursive: true });
    symlinkSync(outsideDirectory, join(fixture.workspaceDirectory, "escape"), "dir");

    const result = await fixture.service.applyPatch({
      workspaceId: fixture.workspace.workspaceId,
      patch: newFilePatch("escape/owned.txt"),
    });

    assert.equal(result.applied, false);
    assert.equal(result.diagnostics[0]?.code, "unsafe_path");
    assert.equal(existsSync(join(outsideDirectory, "owned.txt")), false);
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});

test("WorkspacePatchService enforces patch byte limit without applying", async () => {
  const fixture = createFixture();
  try {
    initGitRepository(fixture.workspaceDirectory);
    const result = await fixture.service.applyPatch({
      workspaceId: fixture.workspace.workspaceId,
      patch: "x".repeat(2_000_001),
    });

    assert.equal(result.applied, false);
    assert.equal(result.diagnostics[0]?.code, "patch_too_large");
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});
