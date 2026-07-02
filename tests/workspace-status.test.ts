import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config/env.ts";
import {
  buildWorkspaceStatus,
  WORKSPACE_STATUS_TOOL_NAME,
} from "../src/tools/workspace-status/model.ts";

test("buildWorkspaceStatus exposes the starter tool and local endpoint", () => {
  const config = loadConfig({ PORT: "9999" });
  const status = buildWorkspaceStatus(config);

  assert.equal(status.appName, "Asagao Workspace");
  assert.equal(status.status, "ready_for_local_development");
  assert.equal(status.mcpEndpoint, "http://localhost:9999/mcp");
  assert.deepEqual(status.availableTools, [WORKSPACE_STATUS_TOOL_NAME]);
  assert.ok(status.nextSteps.length > 0);
});
