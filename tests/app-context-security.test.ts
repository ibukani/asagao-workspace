import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppContext } from "../src/app/create-app-context.ts";
import { loadConfig } from "../src/config/env.ts";

test("app context wires runner security services", () => {
  const parent = mkdtempSync(join(tmpdir(), "asagao-app-security-"));
  try {
    const context = createAppContext({
      config: loadConfig({
        PORT: "9999",
        ASAGAO_WORKSPACE_ROOT: join(parent, "workspaces"),
      }),
      clock: () => new Date("2026-07-02T12:00:00.000Z"),
      createWorkspaceId: () => "wks_appctx001",
    });
    const workspace = context.workspaceRegistry.createWorkspace({});
    const policy = context.security.createWorkspacePolicy(workspace);

    assert.equal(policy.workspaceId, "wks_appctx001");
    assert.equal(policy.internetPolicy, "none");
    assert.equal(policy.command.mode, "deny_all");
    assert.equal(context.workspaceLifecycleStore.list().length, 0);
    assert.equal(
      context.workspaceLifecycleService.getWorkspaceLifecycle(workspace.workspaceId)?.lifecycle.reusable,
      true,
    );
    assert.equal(context.security.logMasker.maskText("plain"), "plain");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
