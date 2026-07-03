import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalWorkspaceTraversal } from "../../src/adapters/files/index.ts";

function createFixture() {
  const parent = mkdtempSync(join(tmpdir(), "asagao-traversal-"));
  const workspaceDirectory = join(parent, "wks_traverse001");
  mkdirSync(workspaceDirectory);
  return { parent, workspaceDirectory };
}

test("LocalWorkspaceTraversal applies denied prefixes, gitignore, symlink, and depth metadata", async () => {
  const fixture = createFixture();
  try {
    mkdirSync(join(fixture.workspaceDirectory, "src"));
    mkdirSync(join(fixture.workspaceDirectory, "dist"));
    mkdirSync(join(fixture.workspaceDirectory, ".git"));
    writeFileSync(join(fixture.workspaceDirectory, ".gitignore"), "dist/\nignored.txt\n");
    writeFileSync(join(fixture.workspaceDirectory, "src", "index.ts"), "export {};\n");
    writeFileSync(join(fixture.workspaceDirectory, "dist", "bundle.js"), "ignored\n");
    writeFileSync(join(fixture.workspaceDirectory, "ignored.txt"), "ignored\n");
    writeFileSync(join(fixture.workspaceDirectory, ".git", "config"), "hidden\n");
    symlinkSync(join(fixture.workspaceDirectory, "src"), join(fixture.workspaceDirectory, "src-link"), "dir");

    const traversal = new LocalWorkspaceTraversal();
    const tree = await traversal.listFileTree({
      workspaceId: "wks_traverse001",
      workspaceDirectory: fixture.workspaceDirectory,
      rootPath: ".",
      maxDepth: 2,
      maxEntries: 20,
      includeFiles: true,
      deniedPathPrefixes: [".git/"],
    });

    assert.deepEqual(
      tree.entries.map((entry) => `${entry.path}:${entry.type}`),
      [".gitignore:file", "src:directory", "src/index.ts:file", "src-link:symlink"],
    );
    assert.equal(tree.omittedCount, 3);
    assert.equal(tree.truncated, false);
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});

test("LocalWorkspaceTraversal search reports binary, ignored, denied, and too large skips", async () => {
  const fixture = createFixture();
  try {
    mkdirSync(join(fixture.workspaceDirectory, "src"));
    mkdirSync(join(fixture.workspaceDirectory, "node_modules"));
    writeFileSync(join(fixture.workspaceDirectory, ".gitignore"), "ignored.txt\n");
    writeFileSync(join(fixture.workspaceDirectory, "src", "a.txt"), "needle\n");
    writeFileSync(join(fixture.workspaceDirectory, "node_modules", "dep.txt"), "needle\n");
    writeFileSync(join(fixture.workspaceDirectory, "ignored.txt"), "needle\n");
    writeFileSync(join(fixture.workspaceDirectory, "big.txt"), "x".repeat(64));
    writeFileSync(join(fixture.workspaceDirectory, "binary.dat"), Buffer.from([0x00, 0x01]));

    const traversal = new LocalWorkspaceTraversal();
    const result = await traversal.searchText({
      workspaceId: "wks_traverse001",
      workspaceDirectory: fixture.workspaceDirectory,
      rootPath: ".",
      query: "needle",
      caseSensitive: false,
      maxResults: 10,
      maxFileBytes: 32,
      maxLineTextBytes: 20,
      deniedPathPrefixes: ["node_modules/"],
    });

    assert.deepEqual(result.matches.map((match) => match.path), ["src/a.txt"]);
    assert.equal(result.skippedFiles.denied, 1);
    assert.equal(result.skippedFiles.ignored, 1);
    assert.equal(result.skippedFiles.tooLarge, 1);
    assert.equal(result.skippedFiles.binary, 1);
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});
