import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_COMMAND_POLICY,
  DEFAULT_SECRET_POLICY,
  commandPolicySchema,
  createCommandPolicy,
  createWorkspaceSecurityPolicy,
  evaluateCommandPolicy,
  evaluateWorkspaceOperationPolicy,
  normalizeWorkspaceRelativePath,
  runnerOperationRequestSchema,
  workspaceRelativePathSchema,
  workspaceSecurityPolicySchema,
} from "../src/security/index.ts";
import { internetPolicySchema } from "../src/domain/index.ts";

const workspace = {
  workspaceId: "wks_security001",
  internetPolicy: "none",
} as const;

test("workspace security policy defaults to explicit default-deny behavior", () => {
  const policy = createWorkspaceSecurityPolicy(workspace);

  assert.equal(policy.workspaceId, "wks_security001");
  assert.equal(policy.internetPolicy, "none");
  assert.deepEqual(policy.secrets, DEFAULT_SECRET_POLICY);
  assert.equal(policy.secrets.injectByDefault, false);
  assert.deepEqual(policy.secrets.allowedSecretNames, []);
  assert.equal(policy.command.mode, "deny_all");
  assert.deepEqual(policy.command.allowlist, []);
  assert.equal(policy.patch.allowApply, false);
  assert.equal(policy.artifact.allowExport, false);
  assert.equal(workspaceSecurityPolicySchema.safeParse(policy).success, true);
});

test("internet policy vocabulary is none, package_registry, and full", () => {
  assert.equal(internetPolicySchema.safeParse("none").success, true);
  assert.equal(internetPolicySchema.safeParse("package_registry").success, true);
  assert.equal(internetPolicySchema.safeParse("full").success, true);
  assert.equal(internetPolicySchema.safeParse("disabled").success, false);
  assert.equal(internetPolicySchema.safeParse("restricted").success, false);
  assert.equal(internetPolicySchema.safeParse("enabled").success, false);
});

test("command policy denies every command by default", () => {
  const decision = evaluateCommandPolicy({
    policy: DEFAULT_COMMAND_POLICY,
    command: ["npm", "test"],
  });

  assert.equal(decision.outcome, "denied");
  assert.equal(decision.reasonCode, "command_default_denied");
});

test("command allowlist can permit specific argument arrays", () => {
  const policy = createCommandPolicy({
    mode: "allowlist",
    allowlist: [{ executable: "npm", argsPrefix: ["run", "verify"] }],
    denylist: [],
  });

  assert.equal(commandPolicySchema.safeParse(policy).success, true);
  assert.equal(
    evaluateCommandPolicy({ policy, command: ["npm", "run", "verify"] }).outcome,
    "allowed",
  );
  assert.equal(
    evaluateCommandPolicy({ policy, command: ["npm", "test"] }).reasonCode,
    "command_not_allowlisted",
  );
});

test("command denylist takes precedence over allowlist", () => {
  const policy = createCommandPolicy({
    mode: "allowlist",
    allowlist: [{ executable: "bash" }],
  });

  const decision = evaluateCommandPolicy({ policy, command: ["bash", "-lc", "echo unsafe"] });

  assert.equal(decision.outcome, "denied");
  assert.equal(decision.reasonCode, "command_denied");
});



test("workspace relative path schema normalizes safe relative paths", () => {
  assert.equal(workspaceRelativePathSchema.parse("./src//security\\policy.ts"), "src/security/policy.ts");
  assert.equal(workspaceRelativePathSchema.parse("docs/./workspace-runner-design.md"), "docs/workspace-runner-design.md");

  const normalized = normalizeWorkspaceRelativePath("src//security/policy.ts");
  assert.equal(normalized.success, true);
  if (normalized.success) {
    assert.equal(normalized.relativePath, "src/security/policy.ts");
  }
});

test("workspace relative path schema rejects unsafe paths", () => {
  for (const relativePath of [
    "foo/../.git/config",
    "../.git/config",
    "/tmp/asagao",
    "C:\\Users\\asagao\\secret.txt",
    "   ",
    "src/\0secret",
  ]) {
    assert.equal(
      workspaceRelativePathSchema.safeParse(relativePath).success,
      false,
      `expected unsafe path to be rejected: ${JSON.stringify(relativePath)}`,
    );
  }
});

test("workspace operation policy covers file, patch, command, and artifact operations", () => {
  const policy = createWorkspaceSecurityPolicy(workspace);

  assert.equal(
    evaluateWorkspaceOperationPolicy(policy, runnerOperationRequestSchema.parse({
      workspaceId: "wks_security001",
      operationKind: "file",
      action: "read_file",
      actor: "assistant",
      relativePath: "src/index.ts",
    })).outcome,
    "allowed",
  );

  assert.equal(
    evaluateWorkspaceOperationPolicy(policy, runnerOperationRequestSchema.parse({
      workspaceId: "wks_security001",
      operationKind: "file",
      action: "write_file",
      actor: "assistant",
      relativePath: "src/index.ts",
    })).reasonCode,
    "file_write_denied",
  );

  assert.equal(
    evaluateWorkspaceOperationPolicy(policy, runnerOperationRequestSchema.parse({
      workspaceId: "wks_security001",
      operationKind: "patch",
      action: "apply_patch",
      actor: "assistant",
    })).reasonCode,
    "patch_apply_denied",
  );

  assert.equal(
    evaluateWorkspaceOperationPolicy(policy, runnerOperationRequestSchema.parse({
      workspaceId: "wks_security001",
      operationKind: "command",
      action: "run_command",
      actor: "assistant",
      command: ["npm", "test"],
    })).reasonCode,
    "command_default_denied",
  );

  assert.equal(
    evaluateWorkspaceOperationPolicy(policy, runnerOperationRequestSchema.parse({
      workspaceId: "wks_security001",
      operationKind: "artifact",
      action: "create_artifact",
      actor: "assistant",
    })).outcome,
    "allowed",
  );
});

test("workspace operation policy rejects mismatched workspace and denied file prefixes", () => {
  const policy = createWorkspaceSecurityPolicy(workspace);

  assert.equal(
    evaluateWorkspaceOperationPolicy(policy, runnerOperationRequestSchema.parse({
      workspaceId: "wks_other001",
      operationKind: "file",
      action: "read_file",
      actor: "assistant",
      relativePath: "src/index.ts",
    })).reasonCode,
    "workspace_policy_mismatch",
  );

  assert.equal(
    evaluateWorkspaceOperationPolicy(policy, runnerOperationRequestSchema.parse({
      workspaceId: "wks_security001",
      operationKind: "file",
      action: "read_file",
      actor: "assistant",
      relativePath: ".git/config",
    })).reasonCode,
    "path_denied",
  );
});


test("workspace operation policy fails closed for unparsed unsafe relative paths", () => {
  const policy = createWorkspaceSecurityPolicy(workspace);

  const decision = evaluateWorkspaceOperationPolicy(policy, {
    workspaceId: "wks_security001",
    operationKind: "file",
    action: "read_file",
    actor: "assistant",
    relativePath: "foo/../.git/config",
  });

  assert.equal(decision.outcome, "denied");
  assert.equal(decision.reasonCode, "invalid_relative_path");
});
