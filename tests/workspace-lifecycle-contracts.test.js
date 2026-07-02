import test from "node:test";
import assert from "node:assert/strict";
import {
  CREATE_WORKSPACE_TOOL_NAME,
  DELETE_WORKSPACE_TOOL_NAME,
  GET_WORKSPACE_TOOL_NAME,
  LIST_WORKSPACES_TOOL_NAME,
  WORKSPACE_LIFECYCLE_TOOL_NAMES,
  createWorkspaceInputSchema,
  createWorkspaceOutputSchema,
  deleteWorkspaceInputSchema,
  deleteWorkspaceOutputSchema,
  getWorkspaceInputSchema,
  getWorkspaceOutputSchema,
  listWorkspacesInputSchema,
  listWorkspacesOutputSchema,
} from "../src/tools/workspace-lifecycle/contracts.js";
import {
  createToolError,
  createToolSuccess,
  createWorkspaceModel,
} from "../src/domain/index.js";

const NOW = new Date("2026-07-02T00:00:00.000Z");

function sampleWorkspace() {
  return createWorkspaceModel({ workspaceId: "ws_1", status: "ready" }, { now: NOW });
}

test("workspace lifecycle tool names are stable", () => {
  assert.deepEqual(WORKSPACE_LIFECYCLE_TOOL_NAMES, [
    CREATE_WORKSPACE_TOOL_NAME,
    LIST_WORKSPACES_TOOL_NAME,
    GET_WORKSPACE_TOOL_NAME,
    DELETE_WORKSPACE_TOOL_NAME,
  ]);
});

test("create_workspace input contract accepts repository metadata without executing it", () => {
  const input = createWorkspaceInputSchema.parse({
    repoUrl: "https://github.com/ibukani/asagao-workspace.git",
    branch: "main",
    baseRef: "HEAD",
    workspaceName: "asagao",
    runtimeProfile: "node",
    internetPolicy: "package_registry",
    ttlMinutes: 60,
  });

  assert.equal(input.workspaceName, "asagao");
  assert.equal(input.runtimeProfile, "node");
  assert.throws(
    () => createWorkspaceInputSchema.parse({ internetPolicy: "unrestricted" }),
    /Invalid option/,
  );
});

test("workspace lifecycle lookup schemas require workspaceId", () => {
  assert.deepEqual(listWorkspacesInputSchema.parse({}), {});
  assert.deepEqual(listWorkspacesInputSchema.parse({ includeDeleted: true }), {
    includeDeleted: true,
  });
  assert.deepEqual(getWorkspaceInputSchema.parse({ workspaceId: "ws_1" }), {
    workspaceId: "ws_1",
  });
  assert.deepEqual(deleteWorkspaceInputSchema.parse({ workspaceId: "ws_1" }), {
    workspaceId: "ws_1",
  });
  assert.throws(() => getWorkspaceInputSchema.parse({ workspaceId: "" }));
});

test("workspace lifecycle output contracts use the common result envelope", () => {
  const workspace = sampleWorkspace();

  createWorkspaceOutputSchema.parse(createToolSuccess({
    result: { workspace },
    message: "Workspace created.",
  }));
  listWorkspacesOutputSchema.parse(createToolSuccess({
    result: { workspaces: [workspace] },
  }));
  getWorkspaceOutputSchema.parse(createToolSuccess({
    result: { workspace },
  }));
  deleteWorkspaceOutputSchema.parse(createToolSuccess({
    result: { workspace },
  }));

  createWorkspaceOutputSchema.parse(createToolError({
    code: "invalid_input",
    message: "Invalid workspace request.",
    details: { field: "ttlMinutes" },
  }));
});
