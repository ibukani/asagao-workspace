import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "../src/config/env.ts";
import { createRunnerSecurityServices } from "../src/security/index.ts";
import { LocalWorkspaceFilesystem } from "../src/services/local-workspace-filesystem.ts";
import { WorkspacePatchService } from "../src/services/workspace-patch-service.ts";
import { WorkspaceRegistry } from "../src/services/workspace-registry.ts";
import { InMemoryWorkspaceStore } from "../src/storage/in-memory-workspace-store.ts";
import { applyPatchOutputSchema } from "../src/tools/workspace-patch/contracts.ts";
import { buildApplyPatchResult } from "../src/tools/workspace-patch/model.ts";
import { registerWorkspacePatchTools } from "../src/tools/workspace-patch/register.ts";

type RegisteredToolHandler = (input: unknown) => Promise<{
  structuredContent: unknown;
  content: Array<{ type: "text"; text: string }>;
}>;

type RegisteredToolRecord = {
  config: unknown;
  handler: RegisteredToolHandler;
};

function createFakeMcpServer() {
  const tools = new Map<string, RegisteredToolRecord>();

  const server = {
    registerTool(name: string, config: unknown, handler: RegisteredToolHandler) {
      tools.set(name, { config, handler });
      return { name };
    },
  } as unknown as McpServer;

  return { server, tools };
}

function createFixture() {
  const parent = mkdtempSync(join(tmpdir(), "asagao-patch-tools-"));
  const workspaceRoot = join(parent, "workspaces");
  const filesystem = new LocalWorkspaceFilesystem({ workspaceRoot });
  const registry = new WorkspaceRegistry({
    store: new InMemoryWorkspaceStore(),
    filesystem,
    clock: () => new Date("2026-07-03T12:00:00.000Z"),
    createId: () => "wks_patchtools001",
  });
  const workspace = registry.createWorkspace({ workspaceName: "Patch tool workspace" });
  const workspaceDirectory = join(workspaceRoot, workspace.workspaceId);
  const service = new WorkspacePatchService({
    workspaceRegistry: registry,
    workspaceFilesystem: filesystem,
    security: createRunnerSecurityServices(),
    clock: () => new Date("2026-07-03T12:00:00.000Z"),
    createPatchId: () => "pat_tools001",
  });

  return { parent, workspace, workspaceDirectory, service };
}

function git(cwd: string, args: readonly string[]): void {
  execFileSync("git", [...args], { cwd, stdio: "ignore" });
}

function initGitRepository(workspaceDirectory: string): void {
  git(workspaceDirectory, ["init", "-q"]);
  git(workspaceDirectory, ["config", "user.email", "test@example.com"]);
  git(workspaceDirectory, ["config", "user.name", "Test User"]);
  writeFileSync(join(workspaceDirectory, "README.md"), "hello\n");
  git(workspaceDirectory, ["add", "."]);
  git(workspaceDirectory, ["commit", "-m", "initial"]);
}

function readmePatch(): string {
  return [
    "diff --git a/README.md b/README.md",
    "--- a/README.md",
    "+++ b/README.md",
    "@@ -1 +1,2 @@",
    " hello",
    "+patched",
    "",
  ].join("\n");
}

test("workspace patch model returns structured non-applied results for empty patches", async () => {
  const fixture = createFixture();
  try {
    initGitRepository(fixture.workspaceDirectory);

    const empty = await buildApplyPatchResult(fixture.service, {
      workspaceId: fixture.workspace.workspaceId,
      patch: "",
    });
    const applied = await buildApplyPatchResult(fixture.service, {
      workspaceId: fixture.workspace.workspaceId,
      patch: readmePatch(),
    });

    assert.equal(empty.ok, true);
    assert.equal(empty.data.applied, false);
    assert.equal(empty.data.diagnostics[0]?.code, "empty_patch");
    assert.equal(applyPatchOutputSchema.safeParse(empty).success, true);

    assert.equal(applied.ok, true);
    assert.equal(applied.data.applied, true);
    assert.equal(applied.data.checkedFiles[0], "README.md");
    assert.equal(applyPatchOutputSchema.safeParse(applied).success, true);
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});

test("workspace patch model keeps schema validation failures in the error envelope", async () => {
  const fixture = createFixture();
  try {
    initGitRepository(fixture.workspaceDirectory);

    const invalid = await buildApplyPatchResult(fixture.service, {
      workspaceId: fixture.workspace.workspaceId,
      patch: readmePatch(),
      mode: "invalid-mode",
    });

    assert.equal(invalid.ok, false);
    assert.equal(invalid.error.code, "invalid_input");
    assert.equal(applyPatchOutputSchema.safeParse(invalid).success, true);
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});

test("workspace patch model reports non-git workspaces as structured failures", async () => {
  const fixture = createFixture();
  try {
    const nonGit = await buildApplyPatchResult(fixture.service, {
      workspaceId: fixture.workspace.workspaceId,
      patch: readmePatch(),
    });

    assert.equal(nonGit.ok, false);
    assert.equal(nonGit.error.code, "not_git_workspace");
    assert.equal(applyPatchOutputSchema.safeParse(nonGit).success, true);
    const serialized = JSON.stringify(nonGit);
    assert.equal(serialized.includes(fixture.workspaceDirectory), false);
    assert.doesNotMatch(serialized, /GitAdapterError|AdapterError|ExecaError|execa/i);
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});

test("workspace patch registration wires Apps SDK handler to the shared service", async () => {
  const fixture = createFixture();
  try {
    initGitRepository(fixture.workspaceDirectory);
    assert.equal(existsSync(join(fixture.workspaceDirectory, "README.md")), true);

    const { server, tools } = createFakeMcpServer();
    registerWorkspacePatchTools(server, {
      config: loadConfig({ PORT: "9999" }),
      workspacePatchService: fixture.service,
    });

    assert.deepEqual([...tools.keys()], ["apply_patch"]);
    const applyPatchHandler = requireRegisteredHandler(tools, "apply_patch");
    const result = await applyPatchHandler({
      workspaceId: fixture.workspace.workspaceId,
      patch: readmePatch(),
    });

    assert.equal(result.content[0]?.text, "Workspace patch operation completed.");
    assert.equal(applyPatchOutputSchema.safeParse(result.structuredContent).success, true);
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});

function requireRegisteredHandler(
  tools: Map<string, RegisteredToolRecord>,
  name: string,
): RegisteredToolHandler {
  const handler = tools.get(name)?.handler;
  assert.ok(handler, `expected ${name} to be registered`);
  return handler;
}
