import { z } from "zod";
import { workspaceIdSchema } from "./workspace.ts";

export const gitChangedFileStatuses = [
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "untracked",
  "conflicted",
  "type_changed",
  "unknown",
] as const;

export const gitPatchOmittedReasons = [
  "not_requested",
  "max_patch_bytes",
  "binary_patch_omitted",
] as const;

export const gitChangedFileStatusSchema = z.enum(gitChangedFileStatuses);
export const gitPatchOmittedReasonSchema = z.enum(gitPatchOmittedReasons);

export const gitStatusCodeSchema = z.string().min(1).max(2);

export const gitChangedFileSchema = z
  .object({
    path: z.string().min(1),
    previousPath: z.string().min(1).optional(),
    status: gitChangedFileStatusSchema,
    indexStatus: gitStatusCodeSchema.nullable(),
    workTreeStatus: gitStatusCodeSchema.nullable(),
    staged: z.boolean(),
    unstaged: z.boolean(),
    untracked: z.boolean(),
    conflicted: z.boolean(),
    binary: z.boolean().optional(),
    additions: z.number().int().nonnegative().optional(),
    deletions: z.number().int().nonnegative().optional(),
  })
  .strict();

export const gitStatusLimitsSchema = z
  .object({
    maxFiles: z.number().int().positive(),
  })
  .strict();

export const workspaceGitStatusDataSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    clean: z.boolean(),
    branch: z.string().min(1).nullable(),
    headCommit: z.string().min(1).nullable(),
    changedFiles: z.array(gitChangedFileSchema),
    truncated: z.boolean(),
    totalChangedFiles: z.number().int().nonnegative(),
    limits: gitStatusLimitsSchema,
  })
  .strict();

export const workspaceDiffStatSchema = z
  .object({
    filesChanged: z.number().int().nonnegative(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    binaryFiles: z.number().int().nonnegative(),
  })
  .strict();

export const workspaceDiffPatchSchema = z
  .object({
    included: z.boolean(),
    content: z.string(),
    truncated: z.boolean(),
    returnedBytes: z.number().int().nonnegative(),
    maxBytes: z.number().int().positive(),
    omittedReason: gitPatchOmittedReasonSchema.optional(),
  })
  .strict();

export const workspaceDiffLimitsSchema = z
  .object({
    maxFiles: z.number().int().positive(),
    maxPatchBytes: z.number().int().positive(),
  })
  .strict();

export const workspaceDiffDataSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    clean: z.boolean(),
    branch: z.string().min(1).nullable(),
    headCommit: z.string().min(1).nullable(),
    changedFiles: z.array(gitChangedFileSchema),
    changedFilesTruncated: z.boolean(),
    totalChangedFiles: z.number().int().nonnegative(),
    diffstat: workspaceDiffStatSchema,
    patch: workspaceDiffPatchSchema,
    limits: workspaceDiffLimitsSchema,
  })
  .strict();

export type GitChangedFileStatus = z.infer<typeof gitChangedFileStatusSchema>;
export type GitChangedFile = z.infer<typeof gitChangedFileSchema>;
export type WorkspaceGitStatusData = z.infer<typeof workspaceGitStatusDataSchema>;
export type WorkspaceDiffStat = z.infer<typeof workspaceDiffStatSchema>;
export type WorkspaceDiffPatch = z.infer<typeof workspaceDiffPatchSchema>;
export type WorkspaceDiffData = z.infer<typeof workspaceDiffDataSchema>;
