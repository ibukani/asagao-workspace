import { z } from "zod";
import { createPrefixedIdSchema, isoDateTimeSchema } from "./common.ts";

export const runtimeProfiles = ["node", "python", "rust", "generic"] as const;
export const workspaceStatuses = ["creating", "ready", "failed", "deleted"] as const;
export const internetPolicies = ["disabled", "restricted", "enabled"] as const;

export const runtimeProfileSchema = z.enum(runtimeProfiles);
export const workspaceStatusSchema = z.enum(workspaceStatuses);
export const internetPolicySchema = z.enum(internetPolicies);
export const workspaceIdSchema = createPrefixedIdSchema("wks");

export const workspaceSourceSchema = z
  .object({
    type: z.enum(["empty", "git"]),
    repoUrl: z.string().url().optional(),
    branch: z.string().min(1).optional(),
    baseRef: z.string().min(1).optional(),
  })
  .strict();

export const workspaceSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    name: z.string().min(1),
    status: workspaceStatusSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema.nullable(),
    runtimeProfile: runtimeProfileSchema,
    source: workspaceSourceSchema,
  })
  .strict();

export type RuntimeProfile = z.infer<typeof runtimeProfileSchema>;
export type WorkspaceStatus = z.infer<typeof workspaceStatusSchema>;
export type InternetPolicy = z.infer<typeof internetPolicySchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
