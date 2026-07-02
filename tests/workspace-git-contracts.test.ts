import test from "node:test";
import assert from "node:assert/strict";
import {
  WORKSPACE_GIT_TOOL_NAMES,
  getGitStatusInputSchema,
  getGitStatusOutputSchema,
  getWorkspaceDiffInputSchema,
  getWorkspaceDiffOutputSchema,
} from "../src/tools/workspace-git/contracts.ts";

const workspaceId = "wks_git001";

test("workspace git tool names are stable and exported", () => {
  assert.deepEqual(WORKSPACE_GIT_TOOL_NAMES, [
    "get_git_status",
    "get_workspace_diff",
  ]);
});

test("get_git_status input defaults and output include structured file status", () => {
  assert.deepEqual(getGitStatusInputSchema.parse({ workspaceId }), {
    workspaceId,
    maxFiles: 500,
  });

  const response = {
    ok: true,
    data: {
      workspaceId,
      clean: false,
      branch: "main",
      headCommit: "abc123",
      changedFiles: [
        {
          path: "src/index.ts",
          status: "modified",
          indexStatus: null,
          workTreeStatus: "M",
          staged: false,
          unstaged: true,
          untracked: false,
          conflicted: false,
          additions: 2,
          deletions: 1,
          binary: false,
        },
      ],
      truncated: false,
      totalChangedFiles: 1,
      limits: { maxFiles: 500 },
    },
  };

  assert.equal(getGitStatusOutputSchema.safeParse(response).success, true);
  assert.equal(getGitStatusInputSchema.safeParse({ workspaceId, maxFiles: 5_001 }).success, false);
});

test("get_workspace_diff input defaults and output include diffstat and bounded patch metadata", () => {
  assert.deepEqual(getWorkspaceDiffInputSchema.parse({ workspaceId }), {
    workspaceId,
    includePatch: true,
    maxFiles: 500,
    maxPatchBytes: 200_000,
  });

  const response = {
    ok: true,
    data: {
      workspaceId,
      clean: false,
      branch: "main",
      headCommit: "abc123",
      changedFiles: [
        {
          path: "README.md",
          status: "modified",
          indexStatus: null,
          workTreeStatus: "M",
          staged: false,
          unstaged: true,
          untracked: false,
          conflicted: false,
          additions: 1,
          deletions: 0,
          binary: false,
        },
      ],
      changedFilesTruncated: false,
      totalChangedFiles: 1,
      diffstat: {
        filesChanged: 1,
        additions: 1,
        deletions: 0,
        binaryFiles: 0,
      },
      patch: {
        included: true,
        content: "diff --git a/README.md b/README.md\n",
        truncated: false,
        returnedBytes: 37,
        maxBytes: 200_000,
      },
      limits: {
        maxFiles: 500,
        maxPatchBytes: 200_000,
      },
    },
  };

  assert.equal(getWorkspaceDiffOutputSchema.safeParse(response).success, true);
  assert.equal(getWorkspaceDiffInputSchema.safeParse({ workspaceId, maxPatchBytes: 2_000_001 }).success, false);
});
