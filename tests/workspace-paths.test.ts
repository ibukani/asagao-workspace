import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  WORKSPACE_PATH_ERROR_CODES,
  WorkspacePathBoundaryError,
  WorkspacePathResolver,
  normalizeWorkspaceRootPath,
} from "../src/filesystem/workspace-paths.ts";

test("normalizeWorkspaceRootPath returns an absolute non-root path", () => {
  assert.equal(normalizeWorkspaceRootPath(".asagao/workspaces"), resolve(".asagao/workspaces"));
});

test("WorkspacePathResolver resolves workspace directories under root", () => {
  const root = mkdtempSync(join(tmpdir(), "asagao-paths-"));
  try {
    const paths = new WorkspacePathResolver({ workspaceRoot: root });

    assert.equal(
      paths.resolveWorkspaceDirectory("wks_path001"),
      join(root, "wks_path001"),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("WorkspacePathResolver rejects invalid workspace ids", () => {
  const root = mkdtempSync(join(tmpdir(), "asagao-paths-"));
  try {
    const paths = new WorkspacePathResolver({ workspaceRoot: root });

    assertWorkspacePathError(
      () => paths.resolveWorkspaceDirectory("../outside"),
      WORKSPACE_PATH_ERROR_CODES.invalidWorkspaceId,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("WorkspacePathResolver rejects relative paths that escape the workspace", () => {
  const root = mkdtempSync(join(tmpdir(), "asagao-paths-"));
  try {
    const paths = new WorkspacePathResolver({ workspaceRoot: root });
    mkdirSync(paths.resolveWorkspaceDirectory("wks_path001"));

    assertWorkspacePathError(
      () => paths.resolveWorkspaceRelativePath("wks_path001", "../outside.txt"),
      WORKSPACE_PATH_ERROR_CODES.pathOutsideWorkspace,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("WorkspacePathResolver rejects absolute and empty relative paths", () => {
  const root = mkdtempSync(join(tmpdir(), "asagao-paths-"));
  try {
    const paths = new WorkspacePathResolver({ workspaceRoot: root });

    assertWorkspacePathError(
      () => paths.resolveWorkspaceRelativePath("wks_path001", resolve("/tmp/file.txt")),
      WORKSPACE_PATH_ERROR_CODES.invalidRelativePath,
    );
    assertWorkspacePathError(
      () => paths.resolveWorkspaceRelativePath("wks_path001", ""),
      WORKSPACE_PATH_ERROR_CODES.invalidRelativePath,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("WorkspacePathResolver does not accept sibling prefix paths as inside root", () => {
  const parent = mkdtempSync(join(tmpdir(), "asagao-prefix-"));
  try {
    const root = join(parent, "workspaces");
    const sibling = join(parent, "workspaces-sibling", "wks_path001");
    mkdirSync(root, { recursive: true });
    mkdirSync(sibling, { recursive: true });
    const paths = new WorkspacePathResolver({ workspaceRoot: root });

    assertWorkspacePathError(
      () => paths.assertPathInsideWorkspace("wks_path001", sibling),
      WORKSPACE_PATH_ERROR_CODES.pathOutsideWorkspace,
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("WorkspacePathResolver rejects symlink traversal outside the workspace", () => {
  const parent = mkdtempSync(join(tmpdir(), "asagao-symlink-"));
  try {
    const root = join(parent, "workspaces");
    const outside = join(parent, "outside");
    const paths = new WorkspacePathResolver({ workspaceRoot: root });
    const workspaceDirectory = paths.resolveWorkspaceDirectory("wks_path001");

    mkdirSync(workspaceDirectory, { recursive: true });
    mkdirSync(outside);
    symlinkSync(outside, join(workspaceDirectory, "outside-link"), "dir");

    assertWorkspacePathError(
      () => paths.resolveWorkspaceRelativePath("wks_path001", "outside-link/file.txt"),
      WORKSPACE_PATH_ERROR_CODES.symlinkEscapesWorkspace,
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

function assertWorkspacePathError(
  operation: () => void,
  code: string,
): void {
  assert.throws(
    operation,
    (error: unknown) =>
      error instanceof WorkspacePathBoundaryError && error.code === code,
  );
}
