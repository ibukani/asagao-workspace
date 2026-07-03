import { z } from "zod";
import { createPrefixedIdSchema } from "./common.ts";
import {
  gitChangedFileSchema,
  workspaceDiffStatSchema,
  workspaceGitStatusDataSchema,
} from "./workspace-git.ts";
import { workspaceIdSchema } from "./workspace.ts";

export const workspacePatchModes = ["check", "apply"] as const;
export const workspacePatchDiagnosticSeverities = ["info", "warning", "error"] as const;
export const workspacePatchDiagnosticCodes = [
  "preflight_succeeded",
  "patch_applied",
  "snapshot_deferred",
  "invalid_patch",
  "patch_too_large",
  "empty_patch",
  "unsafe_path",
  "base_commit_mismatch",
  "git_unavailable",
  "not_git_workspace",
  "git_apply_failed",
  "workspace_not_found",
  "workspace_unavailable",
  "operation_denied",
] as const;
export const workspacePatchSnapshotPolicies = ["deferred_to_issue_13"] as const;

export const workspacePatchIdSchema = createPrefixedIdSchema("pat");
export const workspacePatchModeSchema = z.enum(workspacePatchModes);
export const workspacePatchDiagnosticSeveritySchema = z.enum(workspacePatchDiagnosticSeverities);
export const workspacePatchDiagnosticCodeSchema = z.enum(workspacePatchDiagnosticCodes);
export const workspacePatchSnapshotPolicySchema = z.enum(workspacePatchSnapshotPolicies);

export const workspacePatchDiagnosticSchema = z
  .object({
    code: workspacePatchDiagnosticCodeSchema,
    severity: workspacePatchDiagnosticSeveritySchema,
    message: z.string().min(1),
    path: z.string().min(1).optional(),
  })
  .strict();

export const workspacePatchLimitsSchema = z
  .object({
    maxPatchBytes: z.number().int().positive(),
    maxFiles: z.number().int().positive(),
  })
  .strict();

export const workspacePatchApplyDataSchema = z
  .object({
    patchId: workspacePatchIdSchema,
    workspaceId: workspaceIdSchema,
    mode: workspacePatchModeSchema,
    applied: z.boolean(),
    baseCommit: z.string().min(1).nullable(),
    resultingCommit: z.string().min(1).nullable(),
    checkedFiles: z.array(z.string().min(1)),
    checkedFilesTruncated: z.boolean(),
    totalCheckedFiles: z.number().int().nonnegative(),
    changedFiles: z.array(gitChangedFileSchema),
    changedFilesTruncated: z.boolean(),
    totalChangedFiles: z.number().int().nonnegative(),
    diffstat: workspaceDiffStatSchema,
    gitStatus: workspaceGitStatusDataSchema,
    diagnostics: z.array(workspacePatchDiagnosticSchema),
    snapshotCreated: z.boolean(),
    snapshotPolicy: workspacePatchSnapshotPolicySchema,
    limits: workspacePatchLimitsSchema,
  })
  .strict();

export type WorkspacePatchMode = z.infer<typeof workspacePatchModeSchema>;
export type WorkspacePatchDiagnostic = z.infer<typeof workspacePatchDiagnosticSchema>;
export type WorkspacePatchApplyData = z.infer<typeof workspacePatchApplyDataSchema>;
