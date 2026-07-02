import test from "node:test";
import assert from "node:assert/strict";
import {
  getFileTreeInputSchema,
  getFileTreeOutputSchema,
  readFileInputSchema,
  readFileOutputSchema,
  searchWorkspaceInputSchema,
  searchWorkspaceOutputSchema,
  WORKSPACE_INSPECTION_TOOL_NAMES,
} from "../src/tools/workspace-inspection/contracts.ts";

const workspaceId = "wks_inspect001";

test("workspace inspection tool names are stable and exported", () => {
  assert.deepEqual(WORKSPACE_INSPECTION_TOOL_NAMES, [
    "get_file_tree",
    "read_file",
    "search_workspace",
  ]);
});

test("get_file_tree input defaults and output use the common response envelope", () => {
  assert.deepEqual(getFileTreeInputSchema.parse({ workspaceId }), {
    workspaceId,
    rootPath: ".",
    maxDepth: 4,
    maxEntries: 500,
    includeFiles: true,
  });

  const response = {
    ok: true,
    data: {
      workspaceId,
      rootPath: ".",
      entries: [
        {
          path: "src",
          type: "directory",
          depth: 1,
          sizeBytes: 64,
          modifiedAt: "2026-07-02T12:00:00.000Z",
        },
        {
          path: "src/index.ts",
          type: "file",
          depth: 2,
          sizeBytes: 12,
          modifiedAt: "2026-07-02T12:00:00.000Z",
        },
      ],
      truncated: false,
      omittedCount: 0,
      limits: {
        maxDepth: 4,
        maxEntries: 500,
      },
    },
  };

  assert.equal(getFileTreeOutputSchema.safeParse(response).success, true);
});

test("read_file input validates limits and output includes read metadata", () => {
  assert.deepEqual(readFileInputSchema.parse({ workspaceId, path: "README.md" }), {
    workspaceId,
    path: "README.md",
    startLine: 1,
    maxLines: 400,
    maxBytes: 200_000,
  });

  const response = {
    ok: true,
    data: {
      workspaceId,
      file: {
        path: "README.md",
        encoding: "utf8",
        binary: false,
        sizeBytes: 18,
        startLine: 1,
        endLine: 2,
        returnedLines: 2,
        returnedBytes: 18,
        scannedBytes: 18,
        truncated: false,
        content: "hello\nworkspace\n",
      },
      limits: {
        maxLines: 400,
        maxBytes: 200_000,
      },
    },
  };

  assert.equal(readFileOutputSchema.safeParse(response).success, true);
  assert.equal(readFileInputSchema.safeParse({ workspaceId, path: "a", maxLines: 2_001 }).success, false);
});

test("search_workspace input defaults and output include bounded match metadata", () => {
  assert.deepEqual(searchWorkspaceInputSchema.parse({ workspaceId, query: "needle" }), {
    workspaceId,
    query: "needle",
    rootPath: ".",
    caseSensitive: false,
    maxResults: 50,
    maxFileBytes: 200_000,
  });

  const response = {
    ok: true,
    data: {
      workspaceId,
      query: "needle",
      rootPath: ".",
      caseSensitive: false,
      matches: [
        {
          path: "src/index.ts",
          lineNumber: 3,
          lineText: "const value = 'needle';",
          lineTruncated: false,
          matchStart: 15,
          matchEnd: 21,
        },
      ],
      truncated: false,
      searchedFiles: 1,
      skippedFiles: {
        binary: 0,
        tooLarge: 0,
        denied: 0,
        unreadable: 0,
      },
      limits: {
        maxResults: 50,
        maxFileBytes: 200_000,
        maxLineTextBytes: 500,
      },
    },
  };

  assert.equal(searchWorkspaceOutputSchema.safeParse(response).success, true);
  assert.equal(searchWorkspaceInputSchema.safeParse({ workspaceId, query: "" }).success, false);
});
