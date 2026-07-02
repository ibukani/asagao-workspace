import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { InMemoryAuditEventRecorder } from "../src/security/audit.ts";
import { createRunnerSecurityServices } from "../src/security/index.ts";
import { LocalWorkspaceFilesystem } from "../src/services/local-workspace-filesystem.ts";
import {
  WORKSPACE_INSPECTION_ERROR_CODES,
  WorkspaceInspectionService,
  WorkspaceInspectionServiceError,
} from "../src/services/workspace-inspection-service.ts";
import { WorkspaceRegistry } from "../src/services/workspace-registry.ts";
import { InMemoryWorkspaceStore } from "../src/storage/in-memory-workspace-store.ts";

function createFixture() {
  const parent = mkdtempSync(join(tmpdir(), "asagao-inspection-"));
  const workspaceRoot = join(parent, "workspaces");
  const filesystem = new LocalWorkspaceFilesystem({ workspaceRoot });
  const registry = new WorkspaceRegistry({
    store: new InMemoryWorkspaceStore(),
    filesystem,
    clock: () => new Date("2026-07-02T12:00:00.000Z"),
    createId: () => "wks_inspect001",
  });
  const workspace = registry.createWorkspace({ workspaceName: "Inspection workspace" });
  const workspaceDirectory = join(workspaceRoot, workspace.workspaceId);
  const auditRecorder = new InMemoryAuditEventRecorder();
  const service = new WorkspaceInspectionService({
    workspaceRegistry: registry,
    workspaceFilesystem: filesystem,
    security: createRunnerSecurityServices({ auditRecorder }),
    clock: () => new Date("2026-07-02T12:00:00.000Z"),
  });

  return {
    parent,
    workspaceRoot,
    workspace,
    workspaceDirectory,
    registry,
    auditRecorder,
    service,
  };
}

test("WorkspaceInspectionService lists workspace files without denied directories or host paths", async () => {
  const fixture = createFixture();
  try {
    mkdirSync(join(fixture.workspaceDirectory, "src"));
    mkdirSync(join(fixture.workspaceDirectory, "node_modules"));
    mkdirSync(join(fixture.workspaceDirectory, ".git"));
    writeFileSync(join(fixture.workspaceDirectory, "README.md"), "hello\n");
    writeFileSync(join(fixture.workspaceDirectory, "src", "index.ts"), "export const value = 1;\n");
    writeFileSync(join(fixture.workspaceDirectory, "node_modules", "ignored.js"), "ignored\n");
    writeFileSync(join(fixture.workspaceDirectory, ".git", "config"), "ignored\n");
    symlinkSync(join(fixture.workspaceDirectory, "src"), join(fixture.workspaceDirectory, "src-link"), "dir");

    const result = await fixture.service.getFileTree({
      workspaceId: fixture.workspace.workspaceId,
      maxDepth: 3,
      maxEntries: 20,
    });

    assert.deepEqual(
      result.entries.map((entry) => entry.path),
      ["README.md", "src", "src/index.ts", "src-link"],
    );
    assert.equal(result.entries.find((entry) => entry.path === "src-link")?.type, "symlink");
    assert.equal(result.entries.some((entry) => entry.path.includes(fixture.workspaceRoot)), false);
    assert.equal(result.omittedCount, 2);
    assert.equal(result.truncated, false);
    assert.deepEqual(
      fixture.auditRecorder.listEvents().map((event) => event.eventType),
      ["policy_evaluated", "operation_started", "operation_succeeded"],
    );
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});

test("WorkspaceInspectionService caps file tree output by maxEntries", async () => {
  const fixture = createFixture();
  try {
    writeFileSync(join(fixture.workspaceDirectory, "a.txt"), "a\n");
    writeFileSync(join(fixture.workspaceDirectory, "b.txt"), "b\n");
    writeFileSync(join(fixture.workspaceDirectory, "c.txt"), "c\n");

    const result = await fixture.service.getFileTree({
      workspaceId: fixture.workspace.workspaceId,
      maxEntries: 2,
    });

    assert.equal(result.entries.length, 2);
    assert.equal(result.truncated, true);
    assert.equal(result.omittedCount, 1);
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});


test("WorkspaceInspectionService reports file tree truncation when maxDepth omits children", async () => {
  const fixture = createFixture();
  try {
    mkdirSync(join(fixture.workspaceDirectory, "src"));
    mkdirSync(join(fixture.workspaceDirectory, "src", "nested"));
    writeFileSync(join(fixture.workspaceDirectory, "src", "nested", "deep.txt"), "deep\n");

    const result = await fixture.service.getFileTree({
      workspaceId: fixture.workspace.workspaceId,
      maxDepth: 1,
      maxEntries: 20,
    });

    assert.deepEqual(result.entries.map((entry) => entry.path), ["src"]);
    assert.equal(result.truncated, true);
    assert.equal(result.omittedCount, 1);
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});

test("WorkspaceInspectionService reads bounded UTF-8 line ranges", async () => {
  const fixture = createFixture();
  try {
    writeFileSync(join(fixture.workspaceDirectory, "notes.txt"), "one\ntwo\nthree\nfour\n");

    const result = await fixture.service.readFile({
      workspaceId: fixture.workspace.workspaceId,
      path: "notes.txt",
      startLine: 2,
      maxLines: 2,
      maxBytes: 100,
    });

    assert.equal(result.workspaceId, fixture.workspace.workspaceId);
    assert.equal(result.file.path, "notes.txt");
    assert.equal(result.file.content, "two\nthree\n");
    assert.equal(result.file.startLine, 2);
    assert.equal(result.file.endLine, 3);
    assert.equal(result.file.returnedLines, 2);
    assert.equal(result.file.truncated, true);
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});

test("WorkspaceInspectionService rejects unsafe, denied, binary, and deleted workspace reads", async () => {
  const fixture = createFixture();
  try {
    mkdirSync(join(fixture.workspaceDirectory, ".git"));
    writeFileSync(join(fixture.workspaceDirectory, ".git", "config"), "secret\n");
    writeFileSync(join(fixture.workspaceDirectory, "image.bin"), Buffer.from([0x00, 0x01, 0x02]));

    await assert.rejects(
      fixture.service.readFile({ workspaceId: fixture.workspace.workspaceId, path: "../outside.txt" }),
      (error: unknown) => error instanceof WorkspaceInspectionServiceError
        && error.code === WORKSPACE_INSPECTION_ERROR_CODES.pathDenied,
    );

    await assert.rejects(
      fixture.service.readFile({ workspaceId: fixture.workspace.workspaceId, path: ".git/config" }),
      (error: unknown) => error instanceof WorkspaceInspectionServiceError
        && error.code === WORKSPACE_INSPECTION_ERROR_CODES.pathDenied,
    );

    await assert.rejects(
      fixture.service.readFile({ workspaceId: fixture.workspace.workspaceId, path: "image.bin" }),
      (error: unknown) => error instanceof WorkspaceInspectionServiceError
        && error.code === WORKSPACE_INSPECTION_ERROR_CODES.binaryFileNotReadable,
    );

    fixture.registry.deleteWorkspace(fixture.workspace.workspaceId);
    await assert.rejects(
      fixture.service.getFileTree({ workspaceId: fixture.workspace.workspaceId }),
      (error: unknown) => error instanceof WorkspaceInspectionServiceError
        && error.code === WORKSPACE_INSPECTION_ERROR_CODES.workspaceUnavailable,
    );
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});

test("WorkspaceInspectionService searches text files with result and file size caps", async () => {
  const fixture = createFixture();
  try {
    mkdirSync(join(fixture.workspaceDirectory, "src"));
    mkdirSync(join(fixture.workspaceDirectory, "node_modules"));
    writeFileSync(join(fixture.workspaceDirectory, "src", "a.txt"), "alpha needle\nsecond line\n");
    writeFileSync(join(fixture.workspaceDirectory, "src", "b.txt"), "Needle upper\nneedle lower\n");
    writeFileSync(join(fixture.workspaceDirectory, "big.txt"), "x".repeat(64));
    writeFileSync(join(fixture.workspaceDirectory, "binary.dat"), Buffer.from([0x00, 0x02]));
    writeFileSync(join(fixture.workspaceDirectory, "node_modules", "ignored.txt"), "needle\n");

    const result = await fixture.service.searchWorkspace({
      workspaceId: fixture.workspace.workspaceId,
      query: "needle",
      rootPath: ".",
      maxResults: 2,
      maxFileBytes: 32,
    });

    assert.deepEqual(
      result.matches.map((match) => `${match.path}:${match.lineNumber}:${match.lineText}`),
      ["src/a.txt:1:alpha needle", "src/b.txt:1:Needle upper"],
    );
    assert.equal(result.truncated, true);
    assert.equal(result.skippedFiles.tooLarge, 1);
    assert.equal(result.skippedFiles.binary, 1);
    assert.equal(result.skippedFiles.denied, 1);
    assert.equal(result.searchedFiles, 2);
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});


test("WorkspaceInspectionService keeps search line snippets within byte limits", async () => {
  const fixture = createFixture();
  try {
    writeFileSync(
      join(fixture.workspaceDirectory, "unicode.txt"),
      `${"前".repeat(200)}needle${"後".repeat(200)}\n`,
    );

    const result = await fixture.service.searchWorkspace({
      workspaceId: fixture.workspace.workspaceId,
      query: "needle",
      maxResults: 1,
    });

    const match = result.matches[0];
    assert.ok(match);
    assert.equal(match.lineTruncated, true);
    assert.equal(match.lineText.slice(match.matchStart, match.matchEnd), "needle");
    assert.ok(Buffer.byteLength(match.lineText, "utf8") <= result.limits.maxLineTextBytes);
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});

test("WorkspaceInspectionService reports missing search roots as file_not_found", async () => {
  const fixture = createFixture();
  try {
    await assert.rejects(
      fixture.service.searchWorkspace({
        workspaceId: fixture.workspace.workspaceId,
        query: "needle",
        rootPath: "missing",
      }),
      (error: unknown) => error instanceof WorkspaceInspectionServiceError
        && error.code === WORKSPACE_INSPECTION_ERROR_CODES.fileNotFound,
    );
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});
