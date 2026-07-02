import test from "node:test";
import assert from "node:assert/strict";
import {
  parseGitNumstatZ,
  parseGitStatusPorcelainZ,
} from "../src/services/local-git-repository.ts";

test("parseGitStatusPorcelainZ parses staged, unstaged, untracked, deleted, and renamed files", () => {
  const files = parseGitStatusPorcelainZ([
    " M README.md",
    "A  src/new.ts",
    " D old.txt",
    "?? notes/todo.txt",
    "R  src/new-name.ts",
    "src/old-name.ts",
  ].join("\0") + "\0");

  assert.deepEqual(files.map((file) => ({
    path: file.path,
    previousPath: file.previousPath,
    status: file.status,
    staged: file.staged,
    unstaged: file.unstaged,
    untracked: file.untracked,
  })), [
    {
      path: "README.md",
      previousPath: undefined,
      status: "modified",
      staged: false,
      unstaged: true,
      untracked: false,
    },
    {
      path: "src/new.ts",
      previousPath: undefined,
      status: "added",
      staged: true,
      unstaged: false,
      untracked: false,
    },
    {
      path: "old.txt",
      previousPath: undefined,
      status: "deleted",
      staged: false,
      unstaged: true,
      untracked: false,
    },
    {
      path: "notes/todo.txt",
      previousPath: undefined,
      status: "untracked",
      staged: false,
      unstaged: false,
      untracked: true,
    },
    {
      path: "src/new-name.ts",
      previousPath: "src/old-name.ts",
      status: "renamed",
      staged: true,
      unstaged: false,
      untracked: false,
    },
  ]);
});

test("parseGitStatusPorcelainZ marks conflicted files", () => {
  const [file] = parseGitStatusPorcelainZ("UU src/conflict.ts\0");

  assert.equal(file?.status, "conflicted");
  assert.equal(file?.conflicted, true);
});

test("parseGitNumstatZ parses regular, binary, and renamed numstat records", () => {
  const entries = parseGitNumstatZ([
    "2\t1\tREADME.md",
    "-\t-\timage.bin",
    "1\t0\t",
    "old.txt",
    "new.txt",
  ].join("\0") + "\0");

  assert.deepEqual(entries, [
    { path: "README.md", additions: 2, deletions: 1, binary: false },
    { path: "image.bin", binary: true },
    { path: "new.txt", additions: 1, deletions: 0, binary: false },
  ]);
});
