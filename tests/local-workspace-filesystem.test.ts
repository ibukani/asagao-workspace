import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  LOCAL_WORKSPACE_FILESYSTEM_ERROR_CODES,
  LocalWorkspaceFilesystem,
  LocalWorkspaceFilesystemError,
} from "../src/services/local-workspace-filesystem.ts";

test("LocalWorkspaceFilesystem creates the root and workspace directory", () => {
  const parent = mkdtempSync(join(tmpdir(), "asagao-fs-"));
  try {
    const workspaceRoot = join(parent, "workspaces");
    const filesystem = new LocalWorkspaceFilesystem({ workspaceRoot });

    filesystem.createWorkspaceDirectory("wks_files001");

    assert.equal(lstatSync(workspaceRoot).isDirectory(), true);
    assert.equal(lstatSync(join(workspaceRoot, "wks_files001")).isDirectory(), true);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("LocalWorkspaceFilesystem deletes only the target workspace directory", () => {
  const parent = mkdtempSync(join(tmpdir(), "asagao-fs-"));
  try {
    const workspaceRoot = join(parent, "workspaces");
    const filesystem = new LocalWorkspaceFilesystem({ workspaceRoot });

    filesystem.createWorkspaceDirectory("wks_files001");
    filesystem.createWorkspaceDirectory("wks_files002");
    writeFileSync(join(workspaceRoot, "wks_files001", "output.txt"), "generated");

    filesystem.deleteWorkspaceDirectory("wks_files001");

    assert.equal(existsSync(join(workspaceRoot, "wks_files001")), false);
    assert.equal(lstatSync(join(workspaceRoot, "wks_files002")).isDirectory(), true);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("LocalWorkspaceFilesystem treats missing workspace directory deletion as idempotent", () => {
  const parent = mkdtempSync(join(tmpdir(), "asagao-fs-"));
  try {
    const workspaceRoot = join(parent, "workspaces");
    const filesystem = new LocalWorkspaceFilesystem({ workspaceRoot });

    filesystem.ensureWorkspaceRoot();
    filesystem.deleteWorkspaceDirectory("wks_files001");

    assert.equal(lstatSync(workspaceRoot).isDirectory(), true);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("LocalWorkspaceFilesystem rejects a workspace root that is a file", () => {
  const parent = mkdtempSync(join(tmpdir(), "asagao-fs-"));
  try {
    const workspaceRoot = join(parent, "workspaces");
    writeFileSync(workspaceRoot, "not a directory");
    const filesystem = new LocalWorkspaceFilesystem({ workspaceRoot });

    assertLocalFilesystemError(
      () => filesystem.ensureWorkspaceRoot(),
      LOCAL_WORKSPACE_FILESYSTEM_ERROR_CODES.rootNotDirectory,
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("LocalWorkspaceFilesystem reports a not-writable workspace root when permissions deny writes", {
  skip: typeof process.getuid === "function" && process.getuid() === 0
    ? "root can bypass write permission checks"
    : false,
}, () => {
  const parent = mkdtempSync(join(tmpdir(), "asagao-fs-"));
  try {
    const workspaceRoot = join(parent, "workspaces");
    mkdirSync(workspaceRoot);
    chmodSync(workspaceRoot, 0o555);
    const filesystem = new LocalWorkspaceFilesystem({ workspaceRoot });

    assertLocalFilesystemError(
      () => filesystem.ensureWorkspaceRoot(),
      LOCAL_WORKSPACE_FILESYSTEM_ERROR_CODES.rootNotWritable,
    );
  } finally {
    chmodSync(parent, 0o755);
    rmSync(parent, { recursive: true, force: true });
  }
});

test("LocalWorkspaceFilesystem rejects symlink workspace directories", () => {
  const parent = mkdtempSync(join(tmpdir(), "asagao-fs-"));
  try {
    const workspaceRoot = join(parent, "workspaces");
    const outside = join(parent, "outside");
    mkdirSync(workspaceRoot);
    mkdirSync(outside);
    symlinkSync(outside, join(workspaceRoot, "wks_files001"), "dir");
    const filesystem = new LocalWorkspaceFilesystem({ workspaceRoot });

    assertLocalFilesystemError(
      () => filesystem.deleteWorkspaceDirectory("wks_files001"),
      LOCAL_WORKSPACE_FILESYSTEM_ERROR_CODES.deleteDirectoryFailed,
    );
    assert.equal(lstatSync(outside).isDirectory(), true);
    assert.equal(lstatSync(join(workspaceRoot, "wks_files001")).isSymbolicLink(), true);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

function assertLocalFilesystemError(
  operation: () => void,
  code: string,
): void {
  assert.throws(
    operation,
    (error: unknown) =>
      error instanceof LocalWorkspaceFilesystemError && error.code === code,
  );
}
