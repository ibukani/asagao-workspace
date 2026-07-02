import { z } from "zod";
import { artifactIdSchema } from "./artifact.ts";
import { commandJobIdSchema } from "./command-job.ts";
import { createPrefixedIdSchema, isoDateTimeSchema } from "./common.ts";
import { workspaceIdSchema } from "./workspace.ts";

export const changeSetStatuses = [
  "pending",
  "ready",
  "applied",
  "failed",
  "discarded",
] as const;

export const changedFileStatuses = [
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "untracked",
] as const;

export const changeSetRiskLevels = ["low", "medium", "high"] as const;

export const changeSetStatusSchema = z.enum(changeSetStatuses);
export const changedFileStatusSchema = z.enum(changedFileStatuses);
export const changeSetRiskLevelSchema = z.enum(changeSetRiskLevels);
export const changeSetIdSchema = createPrefixedIdSchema("chg");

export const changedFileSchema = z
  .object({
    path: z.string().min(1),
    status: changedFileStatusSchema,
    previousPath: z.string().min(1).optional(),
    additions: z.number().int().nonnegative().optional(),
    deletions: z.number().int().nonnegative().optional(),
  })
  .strict();

export const diffStatSchema = z
  .object({
    filesChanged: z.number().int().nonnegative(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
  })
  .strict();

export const commandEvidenceSchema = z
  .object({
    jobId: commandJobIdSchema,
    name: z.string().min(1).optional(),
    status: z.enum(["passed", "failed", "skipped"]),
    summary: z.string().min(1).optional(),
  })
  .strict();

export const artifactRefSchema = z
  .object({
    artifactId: artifactIdSchema,
    name: z.string().min(1),
  })
  .strict();

export const changeSetSchema = z
  .object({
    changeSetId: changeSetIdSchema,
    workspaceId: workspaceIdSchema,
    status: changeSetStatusSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    baseCommit: z.string().min(1).nullable().optional(),
    changedFiles: z.array(changedFileSchema),
    diffstat: diffStatSchema,
    patchArtifactId: artifactIdSchema.nullable().optional(),
    testEvidence: z.array(commandEvidenceSchema),
    generatedArtifacts: z.array(artifactRefSchema),
    suggestedCommitMessage: z.string().min(1).optional(),
    suggestedPullRequestBody: z.string().min(1).optional(),
    riskLevel: changeSetRiskLevelSchema.optional(),
  })
  .strict();

export type ChangeSetStatus = z.infer<typeof changeSetStatusSchema>;
export type ChangedFileStatus = z.infer<typeof changedFileStatusSchema>;
export type ChangeSetRiskLevel = z.infer<typeof changeSetRiskLevelSchema>;
export type ChangedFile = z.infer<typeof changedFileSchema>;
export type DiffStat = z.infer<typeof diffStatSchema>;
export type CommandEvidence = z.infer<typeof commandEvidenceSchema>;
export type ArtifactRef = z.infer<typeof artifactRefSchema>;
export type ChangeSet = z.infer<typeof changeSetSchema>;
