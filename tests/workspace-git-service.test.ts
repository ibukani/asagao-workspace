import test from "node:test";
import assert from "node:assert/strict";
import {
  execFileSync,
} from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { InMemoryAuditEventRecorder } from "../src/security/audit.ts";
import { createRunnerSecurityServices } from "../src/security/index.ts";
import { LocalWorkspaceFilesystem } from "../src/services/local-workspace-filesystem.ts";
import {
  WORKSPACE_GIT_ERROR_CODES,
  WorkspaceGitService,
  WorkspaceGitServiceError,
} from "../src/services/workspace-git-service.ts";
import { WorkspaceRegistry } from "../src/services/workspace-registry.ts";
import { InMemoryWorkspaceStore } from "../src/storage/in-memory-workspace-store.ts";

function createFixture() {
  const parent = mkdtempSync(join(tmpdir(), "asagao-git-service-"));
  const workspaceRoot = join(parent, "workspaces");
  const filesystem = new LocalWorkspaceFilesystem({ workspaceRoot });
  const registry = new WorkspaceRegistry({
    store: new InMemoryWorkspaceStore(),
    filesystem,
    clock: () => new Date("2026-07-02T12:00:00.000Z"),
    createId: () => "wks_gitservice001",
  });
  const workspace = registry.createWorkspace({ workspaceName: "Git workspace" });
  const workspaceDirectory = join(workspaceRoot, workspace.workspaceId);
  const auditRecorder = new InMemoryAuditEventRecorder();
  const service = new WorkspaceGitService({
    workspaceRegistry: registry,
    workspaceFilesystem: filesystem,
    security: createRunnerSecurityServices({ auditRecorder }),
    clock: () => new Date("2026-07-02T12:00:00.000Z"),
  });

  return {
    parent,
    workspace,
    workspaceDirectory,
    registry,
    auditRecorder,
    service,
  };
}

function git(cwd: string, args: readonly string[]): void {
  execFileSync("git", [...args], { cwd, stdio: "ignore" });
}

function initGitRepository(workspaceDirectory: string): void {
  git(workspaceDirectory, ["init"]);
  git(workspaceDirectory, ["config", "user.email", "test@example.com"]);
  git(workspaceDirectory, ["config", "user.name", "Test User"]);
  writeFileSync(join(workspaceDirectory, "README.md"), "hello\n");
  writeFileSync(join(workspaceDirectory, "old.txt"), "remove me\n");
  git(workspaceDirectory, ["add", "."]);
  git(workspaceDirectory, ["commit", "-m", "initial"]);
}

test("WorkspaceGitService returns structured git status without host paths", async () => {
  const fixture = createFixture();
  try {
    initGitRepository(fixture.workspaceDirectory);
    writeFileSync(join(fixture.workspaceDirectory, "README.md"), "hello\nchanged\n");
    writeFileSync(join(fixture.workspaceDirectory, "notes.txt"), "new\nfile\n");
    unlinkSync(join(fixture.workspaceDirectory, "old.txt"));

    const result = await fixture.service.getGitStatus({
      workspaceId: fixture.workspace.workspaceId,
    });

    assert.equal(result.workspaceId, fixture.workspace.workspaceId);
    assert.equal(result.clean, false);
    assert.ok(result.branch);
    assert.ok(result.headCommit);
    assert.equal(result.truncated, false);
    assert.deepEqual(
      result.changedFiles.map((file) => `${file.status}:${file.path}`).sort(),
      ["deleted:old.txt", "modified:README.md", "untracked:notes.txt"],
    );
    assert.equal(JSON.stringify(result).includes(fixture.workspaceDirectory), false);
    assert.deepEqual(
      fixture.auditRecorder.listEvents().map((event) => event.eventType),
      ["policy_evaluated", "operation_started", "operation_succeeded"],
    );
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});

test("WorkspaceGitService returns diffstat and patch for modified, deleted, untracked, and binary files", async () => {
  const fixture = createFixture();
  try {
    initGitRepository(fixture.workspaceDirectory);
    writeFileSync(join(fixture.workspaceDirectory, "README.md"), "hello\nchanged\n");
    writeFileSync(join(fixture.workspaceDirectory, "notes.txt"), "new\nfile\n");
    writeFileSync(join(fixture.workspaceDirectory, "image.bin"), Buffer.from([0x00, 0x01, 0x02]));
    unlinkSync(join(fixture.workspaceDirectory, "old.txt"));

    const result = await fixture.service.getWorkspaceDiff({
      workspaceId: fixture.workspace.workspaceId,
      maxPatchBytes: 20_000,
    });

    assert.equal(result.clean, false);
    assert.equal(result.diffstat.filesChanged, 4);
    assert.equal(result.diffstat.binaryFiles, 1);
    assert.ok(result.diffstat.additions >= 3);
    assert.ok(result.diffstat.deletions >= 1);
    assert.deepEqual(
      result.changedFiles.map((file) => `${file.status}:${file.path}:${file.binary ?? false}`).sort(),
      [
        "deleted:old.txt:false",
        "modified:README.md:false",
        "untracked:image.bin:true",
        "untracked:notes.txt:false",
      ],
    );
    assert.equal(result.patch.included, true);
    assert.equal(result.patch.truncated, false);
    assert.match(result.patch.content, /diff --git a\/README\.md b\/README\.md/);
    assert.match(result.patch.content, /deleted file mode/);
    assert.match(result.patch.content, /diff --git a\/notes\.txt b\/notes\.txt/);
    assert.match(result.patch.content, /Binary files \/dev\/null and b\/image\.bin differ/);
    assert.equal(result.patch.content.includes(fixture.workspaceDirectory), false);
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});

test("WorkspaceGitService truncates oversized patch bodies while preserving metadata", async () => {
  const fixture = createFixture();
  try {
    initGitRepository(fixture.workspaceDirectory);
    writeFileSync(join(fixture.workspaceDirectory, "README.md"), `hello\n${"x".repeat(1000)}\n`);

    const result = await fixture.service.getWorkspaceDiff({
      workspaceId: fixture.workspace.workspaceId,
      maxPatchBytes: 80,
    });

    assert.equal(result.patch.included, true);
    assert.equal(result.patch.truncated, true);
    assert.equal(result.patch.omittedReason, "max_patch_bytes");
    assert.ok(result.patch.returnedBytes <= 80);
    assert.equal(result.changedFiles.length, 1);
    assert.equal(result.diffstat.filesChanged, 1);
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});


test("WorkspaceGitService truncates large untracked patch bodies without reading them into the result", async () => {
  const fixture = createFixture();
  try {
    initGitRepository(fixture.workspaceDirectory);
    writeFileSync(join(fixture.workspaceDirectory, "large-untracked.txt"), `${"large line\n".repeat(20_000)}`);

    const result = await fixture.service.getWorkspaceDiff({
      workspaceId: fixture.workspace.workspaceId,
      maxPatchBytes: 512,
    });

    assert.equal(result.patch.included, true);
    assert.equal(result.patch.truncated, true);
    assert.equal(result.patch.omittedReason, "max_patch_bytes");
    assert.ok(result.patch.returnedBytes <= 512);
    assert.equal(result.diffstat.filesChanged, 1);
    assert.equal(result.changedFiles[0]?.path, "large-untracked.txt");
    assert.equal(result.changedFiles[0]?.additions, 20_000);
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});


test("WorkspaceGitService can omit patch content while still returning status and diffstat", async () => {
  const fixture = createFixture();
  try {
    initGitRepository(fixture.workspaceDirectory);
    writeFileSync(join(fixture.workspaceDirectory, "README.md"), "hello\nchanged\n");

    const result = await fixture.service.getWorkspaceDiff({
      workspaceId: fixture.workspace.workspaceId,
      includePatch: false,
    });

    assert.equal(result.patch.included, false);
    assert.equal(result.patch.content, "");
    assert.equal(result.patch.omittedReason, "not_requested");
    assert.equal(result.diffstat.filesChanged, 1);
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});

test("WorkspaceGitService reports non-git workspaces as structured failures", async () => {
  const fixture = createFixture();
  try {
    await assert.rejects(
      fixture.service.getGitStatus({ workspaceId: fixture.workspace.workspaceId }),
      (error: unknown) => error instanceof WorkspaceGitServiceError
        && error.code === WORKSPACE_GIT_ERROR_CODES.notGitWorkspace,
    );
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});

test("WorkspaceGitService rejects deleted workspaces", async () => {
  const fixture = createFixture();
  try {
    fixture.registry.deleteWorkspace(fixture.workspace.workspaceId);

    await assert.rejects(
      fixture.service.getWorkspaceDiff({ workspaceId: fixture.workspace.workspaceId }),
      (error: unknown) => error instanceof WorkspaceGitServiceError
        && error.code === WORKSPACE_GIT_ERROR_CODES.workspaceUnavailable,
    );
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});
