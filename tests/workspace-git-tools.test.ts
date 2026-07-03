import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "../src/config/env.ts";
import { createRunnerSecurityServices } from "../src/security/index.ts";
import { LocalWorkspaceFilesystem } from "../src/services/local-workspace-filesystem.ts";
import { WorkspaceGitService } from "../src/services/workspace-git-service.ts";
import { WorkspaceRegistry } from "../src/services/workspace-registry.ts";
import { InMemoryWorkspaceStore } from "../src/storage/in-memory-workspace-store.ts";
import {
  getGitStatusOutputSchema,
  getWorkspaceDiffOutputSchema,
} from "../src/tools/workspace-git/contracts.ts";
import {
  buildGetGitStatusResult,
  buildGetWorkspaceDiffResult,
} from "../src/tools/workspace-git/model.ts";
import { registerWorkspaceGitTools } from "../src/tools/workspace-git/register.ts";

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
  const parent = mkdtempSync(join(tmpdir(), "asagao-git-tools-"));
  const workspaceRoot = join(parent, "workspaces");
  const filesystem = new LocalWorkspaceFilesystem({ workspaceRoot });
  const registry = new WorkspaceRegistry({
    store: new InMemoryWorkspaceStore(),
    filesystem,
    clock: () => new Date("2026-07-02T12:00:00.000Z"),
    createId: () => "wks_gittools001",
  });
  const workspace = registry.createWorkspace({ workspaceName: "Git tool workspace" });
  const workspaceDirectory = join(workspaceRoot, workspace.workspaceId);
  const service = new WorkspaceGitService({
    workspaceRegistry: registry,
    workspaceFilesystem: filesystem,
    security: createRunnerSecurityServices(),
    clock: () => new Date("2026-07-02T12:00:00.000Z"),
  });

  return { parent, workspace, workspaceDirectory, service };
}

function git(cwd: string, args: readonly string[]): void {
  execFileSync("git", [...args], { cwd, stdio: "ignore" });
}

function initGitRepository(workspaceDirectory: string): void {
  git(workspaceDirectory, ["init"]);
  git(workspaceDirectory, ["config", "user.email", "test@example.com"]);
  git(workspaceDirectory, ["config", "user.name", "Test User"]);
  writeFileSync(join(workspaceDirectory, "README.md"), "hello\n");
  git(workspaceDirectory, ["add", "."]);
  git(workspaceDirectory, ["commit", "-m", "initial"]);
}

test("workspace git model returns structured status and diff results", async () => {
  const fixture = createFixture();
  try {
    initGitRepository(fixture.workspaceDirectory);
    writeFileSync(join(fixture.workspaceDirectory, "README.md"), "hello\nchanged\n");

    const status = await buildGetGitStatusResult(fixture.service, {
      workspaceId: fixture.workspace.workspaceId,
    });
    const diff = await buildGetWorkspaceDiffResult(fixture.service, {
      workspaceId: fixture.workspace.workspaceId,
    });

    assert.equal(status.ok, true);
    assert.equal(status.data.changedFiles[0]?.path, "README.md");
    assert.equal(getGitStatusOutputSchema.safeParse(status).success, true);

    assert.equal(diff.ok, true);
    assert.equal(diff.data.diffstat.filesChanged, 1);
    assert.match(diff.data.patch.content, /diff --git a\/README\.md b\/README\.md/);
    assert.equal(getWorkspaceDiffOutputSchema.safeParse(diff).success, true);
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});

test("workspace git model reports invalid input and non-git workspaces as failures", async () => {
  const fixture = createFixture();
  try {
    const invalid = await buildGetGitStatusResult(fixture.service, {
      workspaceId: fixture.workspace.workspaceId,
      maxFiles: 0,
    });
    const nonGit = await buildGetWorkspaceDiffResult(fixture.service, {
      workspaceId: fixture.workspace.workspaceId,
    });

    assert.equal(invalid.ok, false);
    assert.equal(invalid.error.code, "invalid_input");
    assert.equal(getGitStatusOutputSchema.safeParse(invalid).success, true);

    assert.equal(nonGit.ok, false);
    assert.equal(nonGit.error.code, "not_git_workspace");
    assert.equal(getWorkspaceDiffOutputSchema.safeParse(nonGit).success, true);
    const serialized = JSON.stringify(nonGit);
    assert.equal(serialized.includes(fixture.workspaceDirectory), false);
    assert.doesNotMatch(serialized, /GitAdapterError|AdapterError|ExecaError|execa/i);
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});

test("workspace git registration wires Apps SDK handlers to the shared service", async () => {
  const fixture = createFixture();
  try {
    initGitRepository(fixture.workspaceDirectory);
    writeFileSync(join(fixture.workspaceDirectory, "README.md"), "hello\nchanged\n");
    assert.equal(existsSync(join(fixture.workspaceDirectory, "README.md")), true);

    const { server, tools } = createFakeMcpServer();
    registerWorkspaceGitTools(server, {
      config: loadConfig({ PORT: "9999" }),
      workspaceGitService: fixture.service,
    });

    assert.deepEqual([...tools.keys()], [
      "get_git_status",
      "get_workspace_diff",
    ]);

    const statusHandler = requireRegisteredHandler(tools, "get_git_status");
    const diffHandler = requireRegisteredHandler(tools, "get_workspace_diff");

    const status = await statusHandler({ workspaceId: fixture.workspace.workspaceId });
    const diff = await diffHandler({ workspaceId: fixture.workspace.workspaceId });

    assert.equal(status.content[0]?.text, "Workspace git status returned.");
    assert.equal(getGitStatusOutputSchema.safeParse(status.structuredContent).success, true);
    assert.equal(diff.content[0]?.text, "Workspace diff returned.");
    assert.equal(getWorkspaceDiffOutputSchema.safeParse(diff.structuredContent).success, true);
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
