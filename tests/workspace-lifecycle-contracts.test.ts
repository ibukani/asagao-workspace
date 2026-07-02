import test from "node:test";
import assert from "node:assert/strict";
import {
  CREATE_WORKSPACE_TOOL_NAME,
  DELETE_WORKSPACE_TOOL_NAME,
  GET_WORKSPACE_TOOL_NAME,
  GET_WORKSPACE_LIFECYCLE_TOOL_NAME,
  LIST_WORKSPACES_TOOL_NAME,
  WORKSPACE_LIFECYCLE_TOOL_NAMES,
  createWorkspaceInputSchema,
  createWorkspaceOutputSchema,
  deleteWorkspaceInputSchema,
  deleteWorkspaceOutputSchema,
  getWorkspaceInputSchema,
  getWorkspaceLifecycleInputSchema,
  getWorkspaceLifecycleOutputSchema,
  getWorkspaceOutputSchema,
  listWorkspacesInputSchema,
  listWorkspacesOutputSchema,
  workspaceLifecycleContracts,
} from "../src/tools/workspace-lifecycle/contracts.ts";

const workspace = {
  workspaceId: "wks_contract123",
  name: "Contract workspace",
  status: "ready",
  createdAt: "2026-07-02T12:00:00.000Z",
  updatedAt: "2026-07-02T12:00:00.000Z",
  expiresAt: "2026-07-02T13:00:00.000Z",
  runtimeProfile: "python",
  internetPolicy: "none",
  source: {
    type: "empty",
  },
};

test("workspace lifecycle tool names are stable and exported", () => {
  assert.deepEqual(WORKSPACE_LIFECYCLE_TOOL_NAMES, [
    CREATE_WORKSPACE_TOOL_NAME,
    LIST_WORKSPACES_TOOL_NAME,
    GET_WORKSPACE_TOOL_NAME,
    DELETE_WORKSPACE_TOOL_NAME,
    GET_WORKSPACE_LIFECYCLE_TOOL_NAME,
  ]);
  assert.equal(workspaceLifecycleContracts.create_workspace.name, CREATE_WORKSPACE_TOOL_NAME);
  assert.equal(workspaceLifecycleContracts.list_workspaces.name, LIST_WORKSPACES_TOOL_NAME);
  assert.equal(workspaceLifecycleContracts.get_workspace.name, GET_WORKSPACE_TOOL_NAME);
  assert.equal(workspaceLifecycleContracts.delete_workspace.name, DELETE_WORKSPACE_TOOL_NAME);
  assert.equal(
    workspaceLifecycleContracts.get_workspace_lifecycle.name,
    GET_WORKSPACE_LIFECYCLE_TOOL_NAME,
  );
});

test("create_workspace input accepts optional fields and validates enums", () => {
  assert.deepEqual(createWorkspaceInputSchema.parse({}), {});
  assert.equal(
    createWorkspaceInputSchema.safeParse({
      repoUrl: "https://github.com/example/project.git",
      branch: "main",
      baseRef: "origin/main",
      workspaceName: "Example",
      runtimeProfile: "rust",
      internetPolicy: "package_registry",
      ttlMinutes: 60,
    }).success,
    true,
  );
  assert.equal(createWorkspaceInputSchema.safeParse({ branch: "main" }).success, false);
  assert.equal(createWorkspaceInputSchema.safeParse({ baseRef: "origin/main" }).success, false);
  assert.equal(createWorkspaceInputSchema.safeParse({ runtimeProfile: "go" }).success, false);
  assert.equal(createWorkspaceInputSchema.safeParse({ internetPolicy: "open" }).success, false);
  assert.equal(createWorkspaceInputSchema.safeParse({ internetPolicy: "restricted" }).success, false);
  assert.equal(createWorkspaceInputSchema.safeParse({ internetPolicy: "disabled" }).success, false);
  assert.equal(createWorkspaceInputSchema.safeParse({ internetPolicy: "enabled" }).success, false);
  assert.equal(createWorkspaceInputSchema.safeParse({ ttlMinutes: -1 }).success, false);
});

test("list_workspaces input and output use the common response shape", () => {
  assert.equal(
    listWorkspacesInputSchema.safeParse({
      status: ["ready", "failed"],
      runtimeProfile: ["node", "generic"],
      includeDeleted: true,
    }).success,
    true,
  );
  assert.equal(listWorkspacesInputSchema.safeParse({ status: ["running"] }).success, false);
  assert.equal(
    listWorkspacesOutputSchema.safeParse({
      ok: true,
      data: { workspaces: [workspace] },
    }).success,
    true,
  );
  assert.equal(
    listWorkspacesOutputSchema.safeParse({
      ok: false,
      error: { code: "registry_unavailable", message: "Registry unavailable" },
    }).success,
    true,
  );
});

test("get_workspace input and output validate workspace ids and response shape", () => {
  assert.equal(getWorkspaceInputSchema.safeParse({ workspaceId: "wks_contract123" }).success, true);
  assert.equal(getWorkspaceInputSchema.safeParse({ workspaceId: "bad-id" }).success, false);
  assert.equal(
    getWorkspaceOutputSchema.safeParse({
      ok: true,
      data: { workspace },
    }).success,
    true,
  );
  assert.equal(
    getWorkspaceOutputSchema.safeParse({
      ok: false,
      error: { code: "workspace_not_found", message: "Workspace not found" },
    }).success,
    true,
  );
});

test("delete_workspace input and output validate ids and deletion marker", () => {
  assert.equal(deleteWorkspaceInputSchema.safeParse({ workspaceId: "wks_contract123" }).success, true);
  assert.equal(deleteWorkspaceInputSchema.safeParse({ workspaceId: "contract123" }).success, false);
  assert.equal(
    deleteWorkspaceOutputSchema.safeParse({
      ok: true,
      data: { workspaceId: "wks_contract123", deleted: true },
    }).success,
    true,
  );
  assert.equal(
    deleteWorkspaceOutputSchema.safeParse({
      ok: false,
      error: { code: "workspace_not_found", message: "Workspace not found" },
    }).success,
    true,
  );
});

test("create_workspace output stays inside the common response envelope", () => {
  assert.equal(
    createWorkspaceOutputSchema.safeParse({
      ok: true,
      data: { workspace },
    }).success,
    true,
  );
  assert.equal(createWorkspaceOutputSchema.safeParse({ workspace }).success, false);
});


test("get_workspace_lifecycle input and output expose a reusable lifecycle snapshot", () => {
  const lifecycle = {
    workspaceId: "wks_contract123",
    workspaceStatus: "ready",
    state: "reusable",
    reusable: true,
    expired: false,
    dirty: false,
    dirtyState: "clean",
    busy: false,
    busyState: "idle",
    blockers: [],
    evaluatedAt: "2026-07-02T12:00:00.000Z",
    expiresAt: "2026-07-02T13:00:00.000Z",
    lastClaimedAt: null,
    lastReusedAt: null,
    lastResetAt: null,
    lastCleanedAt: null,
  };

  assert.equal(
    getWorkspaceLifecycleInputSchema.safeParse({ workspaceId: "wks_contract123" }).success,
    true,
  );
  assert.equal(getWorkspaceLifecycleInputSchema.safeParse({ workspaceId: "bad-id" }).success, false);
  assert.equal(
    getWorkspaceLifecycleOutputSchema.safeParse({
      ok: true,
      data: { workspace, lifecycle },
    }).success,
    true,
  );
  assert.equal(
    getWorkspaceLifecycleOutputSchema.safeParse({
      ok: false,
      error: { code: "workspace_not_found", message: "Workspace not found" },
    }).success,
    true,
  );
});
