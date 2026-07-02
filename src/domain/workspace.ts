import { z } from "zod";
import { createPrefixedIdSchema, isoDateTimeSchema } from "./common.ts";

export const runtimeProfiles = ["node", "python", "rust", "generic"] as const;
export const workspaceStatuses = ["creating", "ready", "failed", "deleted"] as const;
export const internetPolicies = ["disabled", "restricted", "enabled"] as const;

export const runtimeProfileSchema = z.enum(runtimeProfiles);
export const workspaceStatusSchema = z.enum(workspaceStatuses);
export const internetPolicySchema = z.enum(internetPolicies);
export const workspaceIdSchema = createPrefixedIdSchema("wks");

export const emptyWorkspaceSourceSchema = z
  .object({
    type: z.literal("empty"),
  })
  .strict();

export const gitWorkspaceSourceSchema = z
  .object({
    type: z.literal("git"),
    repoUrl: z.string().url(),
    branch: z.string().min(1).optional(),
    baseRef: z.string().min(1).optional(),
  })
  .strict();

export const workspaceSourceSchema = z.discriminatedUnion("type", [
  emptyWorkspaceSourceSchema,
  gitWorkspaceSourceSchema,
]);

export const gitRefSchema = z.string().min(1);

export const workspaceSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    name: z.string().min(1),
    status: workspaceStatusSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema.nullable(),
    runtimeProfile: runtimeProfileSchema,
    internetPolicy: internetPolicySchema,
    source: workspaceSourceSchema,
    baseCommit: gitRefSchema.nullable().optional(),
    currentCommit: gitRefSchema.nullable().optional(),
    defaultBranch: gitRefSchema.nullable().optional(),
    workingBranch: gitRefSchema.nullable().optional(),
  })
  .strict();

export type RuntimeProfile = z.infer<typeof runtimeProfileSchema>;
export type WorkspaceStatus = z.infer<typeof workspaceStatusSchema>;
export type InternetPolicy = z.infer<typeof internetPolicySchema>;
export type EmptyWorkspaceSource = z.infer<typeof emptyWorkspaceSourceSchema>;
export type GitWorkspaceSource = z.infer<typeof gitWorkspaceSourceSchema>;
export type WorkspaceSource = z.infer<typeof workspaceSourceSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
