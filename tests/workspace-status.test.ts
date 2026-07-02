import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config/env.ts";
import { TOOL_NAMES } from "../src/tools/index.ts";
import {
  buildWorkspaceStatus,
  WORKSPACE_STATUS_TOOL_NAME,
} from "../src/tools/workspace-status/model.ts";

test("buildWorkspaceStatus exposes the starter tool and local endpoint by default", () => {
  const config = loadConfig({ PORT: "9999" });
  const status = buildWorkspaceStatus(config);

  assert.equal(status.appName, "Asagao Workspace");
  assert.equal(status.status, "ready_for_local_development");
  assert.equal(status.mcpEndpoint, "http://localhost:9999/mcp");
  assert.deepEqual(status.availableTools, [WORKSPACE_STATUS_TOOL_NAME]);
  assert.ok(status.nextSteps.length > 0);
});

test("buildWorkspaceStatus can expose the registered tool list", () => {
  const config = loadConfig({ PORT: "9999" });
  const status = buildWorkspaceStatus(config, { availableTools: TOOL_NAMES });

  assert.deepEqual(status.availableTools, [
    "get_workspace_status",
    "create_workspace",
    "list_workspaces",
    "get_workspace",
    "delete_workspace",
    "get_workspace_lifecycle",
    "get_file_tree",
    "read_file",
    "search_workspace",
    "get_git_status",
    "get_workspace_diff",
  ]);
});
