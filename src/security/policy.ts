import { posix as pathPosix } from "node:path";
import { z } from "zod";
import {
  internetPolicySchema,
  workspaceIdSchema,
  type InternetPolicy,
  type Workspace,
} from "../domain/index.ts";
import {
  DEFAULT_COMMAND_POLICY,
  commandPolicySchema,
  evaluateCommandPolicy,
  type CommandPolicy,
} from "./command-policy.ts";
import { allowDecision, denyDecision, type PolicyDecision } from "./decision.ts";
import {
  DEFAULT_SECRET_POLICY,
  secretPolicySchema,
  type SecretPolicy,
} from "./secrets.ts";

export const runnerOperationKinds = ["file", "patch", "command", "artifact", "lifecycle"] as const;

export const fileOperationActions = [
  "list_files",
  "search_files",
  "read_file",
  "write_file",
  "delete_file",
] as const;

export const patchOperationActions = [
  "apply_patch",
  "apply_patch_series",
  "rollback_patch",
] as const;

export const commandOperationActions = [
  "run_command",
  "get_command_status",
  "get_command_logs",
  "cancel_command",
] as const;

export const artifactOperationActions = [
  "create_artifact",
  "read_artifact",
  "delete_artifact",
  "export_artifact",
] as const;

export const lifecycleOperationActions = [
  "get_workspace_lifecycle",
  "claim_workspace",
  "reset_workspace",
  "clean_workspace",
] as const;

export const runnerOperationActions = [
  ...fileOperationActions,
  ...patchOperationActions,
  ...commandOperationActions,
  ...artifactOperationActions,
  ...lifecycleOperationActions,
] as const;

export const securityActors = ["assistant", "user", "system", "unknown"] as const;

export const WORKSPACE_RELATIVE_PATH_ERROR_CODE = "invalid_relative_path" as const;

export const runnerOperationKindSchema = z.enum(runnerOperationKinds);
export const runnerOperationActionSchema = z.enum(runnerOperationActions);
export const securityActorSchema = z.enum(securityActors);
export const workspaceRelativePathSchema = z
  .string()
  .min(1)
  .transform((rawPath, context) => {
    const normalizedPath = normalizeWorkspaceRelativePath(rawPath);
    if (!normalizedPath.success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: normalizedPath.message,
      });
      return z.NEVER;
    }

    return normalizedPath.relativePath;
  });

export const fileOperationPolicySchema = z
  .object({
    allowList: z.boolean(),
    allowSearch: z.boolean(),
    allowRead: z.boolean(),
    allowWrite: z.boolean(),
    allowDelete: z.boolean(),
    maxReadBytes: z.number().int().positive(),
    deniedPathPrefixes: z.array(workspaceRelativePathSchema),
  })
  .strict();

export const patchOperationPolicySchema = z
  .object({
    allowApply: z.boolean(),
    allowRollback: z.boolean(),
    requirePreflight: z.boolean(),
    maxPatchBytes: z.number().int().positive(),
  })
  .strict();

export const artifactOperationPolicySchema = z
  .object({
    allowCreate: z.boolean(),
    allowRead: z.boolean(),
    allowDelete: z.boolean(),
    allowExport: z.boolean(),
    maxArtifactBytes: z.number().int().positive(),
  })
  .strict();

export const lifecycleOperationPolicySchema = z
  .object({
    allowGet: z.boolean(),
    allowClaim: z.boolean(),
    allowReset: z.boolean(),
    allowClean: z.boolean(),
  })
  .strict();

export const workspaceSecurityPolicySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    internetPolicy: internetPolicySchema,
    secrets: secretPolicySchema,
    command: commandPolicySchema,
    file: fileOperationPolicySchema,
    patch: patchOperationPolicySchema,
    artifact: artifactOperationPolicySchema,
    lifecycle: lifecycleOperationPolicySchema,
  })
  .strict();

export const runnerOperationRequestSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    operationKind: runnerOperationKindSchema,
    action: runnerOperationActionSchema,
    actor: securityActorSchema.default("unknown"),
    command: z.array(z.string()).optional(),
    relativePath: workspaceRelativePathSchema.optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type RunnerOperationKind = z.infer<typeof runnerOperationKindSchema>;
export type RunnerOperationAction = z.infer<typeof runnerOperationActionSchema>;
export type SecurityActor = z.infer<typeof securityActorSchema>;
export type WorkspaceRelativePath = z.infer<typeof workspaceRelativePathSchema>;
export type FileOperationPolicy = z.infer<typeof fileOperationPolicySchema>;
export type PatchOperationPolicy = z.infer<typeof patchOperationPolicySchema>;
export type ArtifactOperationPolicy = z.infer<typeof artifactOperationPolicySchema>;
export type LifecycleOperationPolicy = z.infer<typeof lifecycleOperationPolicySchema>;
export type WorkspaceSecurityPolicy = z.infer<typeof workspaceSecurityPolicySchema>;
export type RunnerOperationRequest = z.infer<typeof runnerOperationRequestSchema>;

export type CreateWorkspaceSecurityPolicyOverrides = {
  internetPolicy?: InternetPolicy;
  secrets?: Partial<SecretPolicy>;
  command?: Partial<CommandPolicy>;
  file?: Partial<FileOperationPolicy>;
  patch?: Partial<PatchOperationPolicy>;
  artifact?: Partial<ArtifactOperationPolicy>;
  lifecycle?: Partial<LifecycleOperationPolicy>;
};

export const DEFAULT_FILE_OPERATION_POLICY = fileOperationPolicySchema.parse({
  allowList: true,
  allowSearch: true,
  allowRead: true,
  allowWrite: false,
  allowDelete: false,
  maxReadBytes: 1_000_000,
  deniedPathPrefixes: [".git/", "node_modules/", ".asagao/"],
}) satisfies FileOperationPolicy;

export const DEFAULT_PATCH_OPERATION_POLICY = patchOperationPolicySchema.parse({
  allowApply: false,
  allowRollback: false,
  requirePreflight: true,
  maxPatchBytes: 2_000_000,
}) satisfies PatchOperationPolicy;

export const DEFAULT_ARTIFACT_OPERATION_POLICY = artifactOperationPolicySchema.parse({
  allowCreate: true,
  allowRead: true,
  allowDelete: false,
  allowExport: false,
  maxArtifactBytes: 50_000_000,
}) satisfies ArtifactOperationPolicy;

export const DEFAULT_LIFECYCLE_OPERATION_POLICY = lifecycleOperationPolicySchema.parse({
  allowGet: true,
  allowClaim: true,
  allowReset: true,
  allowClean: true,
}) satisfies LifecycleOperationPolicy;

export function createWorkspaceSecurityPolicy(
  workspace: Pick<Workspace, "workspaceId" | "internetPolicy">,
  overrides: CreateWorkspaceSecurityPolicyOverrides = {},
): WorkspaceSecurityPolicy {
  return workspaceSecurityPolicySchema.parse({
    workspaceId: workspace.workspaceId,
    internetPolicy: overrides.internetPolicy ?? workspace.internetPolicy,
    secrets: {
      ...DEFAULT_SECRET_POLICY,
      ...overrides.secrets,
      injectByDefault: false,
    },
    command: {
      ...DEFAULT_COMMAND_POLICY,
      ...overrides.command,
      allowlist: overrides.command?.allowlist ?? DEFAULT_COMMAND_POLICY.allowlist,
      denylist: overrides.command?.denylist ?? DEFAULT_COMMAND_POLICY.denylist,
    },
    file: {
      ...DEFAULT_FILE_OPERATION_POLICY,
      ...overrides.file,
      deniedPathPrefixes: overrides.file?.deniedPathPrefixes
        ?? DEFAULT_FILE_OPERATION_POLICY.deniedPathPrefixes,
    },
    patch: {
      ...DEFAULT_PATCH_OPERATION_POLICY,
      ...overrides.patch,
    },
    artifact: {
      ...DEFAULT_ARTIFACT_OPERATION_POLICY,
      ...overrides.artifact,
    },
    lifecycle: {
      ...DEFAULT_LIFECYCLE_OPERATION_POLICY,
      ...overrides.lifecycle,
    },
  });
}

export function evaluateWorkspaceOperationPolicy(
  policy: WorkspaceSecurityPolicy,
  operation: RunnerOperationRequest,
): PolicyDecision {
  if (policy.workspaceId !== operation.workspaceId) {
    return denyDecision(
      "workspace_policy_mismatch",
      "Workspace operation cannot use a security policy created for another workspace.",
    );
  }

  const expectedKind = inferOperationKind(operation.action);
  if (expectedKind !== operation.operationKind) {
    return denyDecision(
      "operation_kind_action_mismatch",
      `Action '${operation.action}' does not belong to '${operation.operationKind}' operations.`,
    );
  }

  if (operation.relativePath !== undefined) {
    const normalizedPath = normalizeWorkspaceRelativePath(operation.relativePath);
    if (!normalizedPath.success) {
      return denyDecision(
        WORKSPACE_RELATIVE_PATH_ERROR_CODE,
        normalizedPath.message,
      );
    }

    if (pathMatchesDeniedPrefix(normalizedPath.relativePath, policy.file.deniedPathPrefixes)) {
      return denyDecision(
        "path_denied",
        `Path '${normalizedPath.relativePath}' is denied by workspace file policy.`,
      );
    }
  }

  switch (operation.operationKind) {
    case "file":
      return evaluateFileOperationPolicy(policy.file, operation.action);
    case "patch":
      return evaluatePatchOperationPolicy(policy.patch, operation.action);
    case "command":
      return evaluateCommandOperationPolicy(policy.command, operation);
    case "artifact":
      return evaluateArtifactOperationPolicy(policy.artifact, operation.action);
    case "lifecycle":
      return evaluateLifecycleOperationPolicy(policy.lifecycle, operation.action);
  }
}

export function inferOperationKind(action: RunnerOperationAction): RunnerOperationKind {
  if (includesAction(fileOperationActions, action)) {
    return "file";
  }

  if (includesAction(patchOperationActions, action)) {
    return "patch";
  }

  if (includesAction(commandOperationActions, action)) {
    return "command";
  }

  if (includesAction(artifactOperationActions, action)) {
    return "artifact";
  }

  return "lifecycle";
}

function evaluateFileOperationPolicy(
  policy: FileOperationPolicy,
  action: RunnerOperationAction,
): PolicyDecision {
  switch (action) {
    case "list_files":
      return policy.allowList
        ? allowDecision("File listing is allowed by workspace file policy.")
        : denyDecision("file_list_denied", "File listing is denied by workspace file policy.");
    case "search_files":
      return policy.allowSearch
        ? allowDecision("File search is allowed by workspace file policy.")
        : denyDecision("file_search_denied", "File search is denied by workspace file policy.");
    case "read_file":
      return policy.allowRead
        ? allowDecision("File read is allowed by workspace file policy.")
        : denyDecision("file_read_denied", "File read is denied by workspace file policy.");
    case "write_file":
      return policy.allowWrite
        ? allowDecision("File write is allowed by workspace file policy.")
        : denyDecision("file_write_denied", "File write is denied by workspace file policy.");
    case "delete_file":
      return policy.allowDelete
        ? allowDecision("File delete is allowed by workspace file policy.")
        : denyDecision("file_delete_denied", "File delete is denied by workspace file policy.");
    default:
      return denyDecision("unsupported_file_action", "Unsupported file operation action.");
  }
}

function evaluatePatchOperationPolicy(
  policy: PatchOperationPolicy,
  action: RunnerOperationAction,
): PolicyDecision {
  switch (action) {
    case "apply_patch":
    case "apply_patch_series":
      return policy.allowApply
        ? allowDecision("Patch application is allowed by workspace patch policy.")
        : denyDecision("patch_apply_denied", "Patch application is denied by default.");
    case "rollback_patch":
      return policy.allowRollback
        ? allowDecision("Patch rollback is allowed by workspace patch policy.")
        : denyDecision("patch_rollback_denied", "Patch rollback is denied by workspace patch policy.");
    default:
      return denyDecision("unsupported_patch_action", "Unsupported patch operation action.");
  }
}

function evaluateCommandOperationPolicy(
  policy: CommandPolicy,
  operation: RunnerOperationRequest,
): PolicyDecision {
  switch (operation.action) {
    case "run_command":
      return evaluateCommandPolicy({ policy, command: operation.command ?? [] });
    case "get_command_status":
    case "get_command_logs":
      return allowDecision("Command read operation is allowed.");
    case "cancel_command":
      return denyDecision("command_cancel_denied", "Command cancellation is denied until command jobs exist.");
    default:
      return denyDecision("unsupported_command_action", "Unsupported command operation action.");
  }
}

function evaluateArtifactOperationPolicy(
  policy: ArtifactOperationPolicy,
  action: RunnerOperationAction,
): PolicyDecision {
  switch (action) {
    case "create_artifact":
      return policy.allowCreate
        ? allowDecision("Artifact creation is allowed by workspace artifact policy.")
        : denyDecision("artifact_create_denied", "Artifact creation is denied by workspace artifact policy.");
    case "read_artifact":
      return policy.allowRead
        ? allowDecision("Artifact read is allowed by workspace artifact policy.")
        : denyDecision("artifact_read_denied", "Artifact read is denied by workspace artifact policy.");
    case "delete_artifact":
      return policy.allowDelete
        ? allowDecision("Artifact delete is allowed by workspace artifact policy.")
        : denyDecision("artifact_delete_denied", "Artifact delete is denied by workspace artifact policy.");
    case "export_artifact":
      return policy.allowExport
        ? allowDecision("Artifact export is allowed by workspace artifact policy.")
        : denyDecision("artifact_export_denied", "Artifact export is denied by workspace artifact policy.");
    default:
      return denyDecision("unsupported_artifact_action", "Unsupported artifact operation action.");
  }
}


function evaluateLifecycleOperationPolicy(
  policy: LifecycleOperationPolicy,
  action: RunnerOperationAction,
): PolicyDecision {
  switch (action) {
    case "get_workspace_lifecycle":
      return policy.allowGet
        ? allowDecision("Workspace lifecycle inspection is allowed by workspace lifecycle policy.")
        : denyDecision("lifecycle_get_denied", "Workspace lifecycle inspection is denied by policy.");
    case "claim_workspace":
      return policy.allowClaim
        ? allowDecision("Workspace claim is allowed by workspace lifecycle policy.")
        : denyDecision("lifecycle_claim_denied", "Workspace claim is denied by policy.");
    case "reset_workspace":
      return policy.allowReset
        ? allowDecision("Workspace reset boundary is allowed by workspace lifecycle policy.")
        : denyDecision("lifecycle_reset_denied", "Workspace reset is denied by policy.");
    case "clean_workspace":
      return policy.allowClean
        ? allowDecision("Workspace clean boundary is allowed by workspace lifecycle policy.")
        : denyDecision("lifecycle_clean_denied", "Workspace clean is denied by policy.");
    default:
      return denyDecision("unsupported_lifecycle_action", "Unsupported lifecycle operation action.");
  }
}

export type NormalizeWorkspaceRelativePathResult =
  | {
    success: true;
    relativePath: string;
  }
  | {
    success: false;
    reasonCode: typeof WORKSPACE_RELATIVE_PATH_ERROR_CODE;
    message: string;
  };

export function normalizeWorkspaceRelativePath(rawPath: string): NormalizeWorkspaceRelativePathResult {
  const slashNormalizedPath = rawPath.replaceAll("\\", "/");

  if (slashNormalizedPath.includes("\0")) {
    return invalidRelativePath("Workspace relative path must not contain NUL bytes.");
  }

  if (slashNormalizedPath.trim() === "") {
    return invalidRelativePath("Workspace relative path must not be empty.");
  }

  if (pathPosix.isAbsolute(slashNormalizedPath)) {
    return invalidRelativePath(`Workspace relative path must not be absolute: ${rawPath}`);
  }

  if (/^[A-Za-z]:($|\/)/.test(slashNormalizedPath)) {
    return invalidRelativePath(`Workspace relative path must not include a drive prefix: ${rawPath}`);
  }

  if (slashNormalizedPath.split("/").includes("..")) {
    return invalidRelativePath(`Workspace relative path must not contain parent directory segments: ${rawPath}`);
  }

  const normalizedPath = stripTrailingSlashes(pathPosix.normalize(slashNormalizedPath));
  if (normalizedPath === "." || normalizedPath === "") {
    return invalidRelativePath("Workspace relative path must not resolve to the current directory.");
  }

  if (pathPosix.isAbsolute(normalizedPath) || normalizedPath === ".." || normalizedPath.startsWith("../")) {
    return invalidRelativePath(`Workspace relative path escapes the workspace boundary: ${rawPath}`);
  }

  if (normalizedPath.split("/").includes("..")) {
    return invalidRelativePath(`Workspace relative path must not contain parent directory segments: ${rawPath}`);
  }

  return { success: true, relativePath: normalizedPath };
}

function stripTrailingSlashes(normalizedPath: string): string {
  return normalizedPath.replace(/\/+$/, "");
}

function invalidRelativePath(message: string): NormalizeWorkspaceRelativePathResult {
  return {
    success: false,
    reasonCode: WORKSPACE_RELATIVE_PATH_ERROR_CODE,
    message,
  };
}

function pathMatchesDeniedPrefix(
  normalizedRelativePath: string,
  deniedPathPrefixes: readonly string[],
): boolean {
  return deniedPathPrefixes.some((prefix) => (
    normalizedRelativePath === prefix || normalizedRelativePath.startsWith(`${prefix}/`)
  ));
}

function includesAction<Action extends RunnerOperationAction>(
  actions: readonly Action[],
  action: RunnerOperationAction,
): action is Action {
  return actions.includes(action as Action);
}
