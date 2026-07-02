import { z } from "zod";
import { createPrefixedIdSchema, isoDateTimeSchema } from "./common.ts";

export const runtimeProfiles = ["node", "python", "rust", "generic"] as const;
export const workspaceStatuses = ["creating", "ready", "failed", "deleted"] as const;
export const internetPolicies = ["none", "package_registry", "full"] as const;

export const DEFAULT_RUNTIME_PROFILE = "generic" satisfies RuntimeProfile;
export const DEFAULT_INTERNET_POLICY = "none" satisfies InternetPolicy;

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

export type CreateWorkspaceModelInput = {
  workspaceId: string;
  name?: string;
  status?: WorkspaceStatus;
  source?: WorkspaceSource;
  runtimeProfile?: RuntimeProfile;
  internetPolicy?: InternetPolicy;
  ttlMinutes?: number;
  baseCommit?: string | null;
  currentCommit?: string | null;
  defaultBranch?: string | null;
  workingBranch?: string | null;
};

export type CreateWorkspaceModelOptions = {
  now?: Date;
};

export type UpdateWorkspaceStatusOptions = {
  status: WorkspaceStatus;
  updatedAt?: Date;
};

export type MarkWorkspaceDeletedOptions = {
  deletedAt?: Date;
};

export function createWorkspaceModel(
  input: CreateWorkspaceModelInput,
  { now = new Date() }: CreateWorkspaceModelOptions = {},
): Workspace {
  const timestamp = toIsoDateTime(now);
  const workspace = {
    workspaceId: input.workspaceId,
    name: input.name ?? defaultWorkspaceName(input.workspaceId),
    status: input.status ?? "ready",
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: calculateExpiresAt(now, input.ttlMinutes),
    runtimeProfile: input.runtimeProfile ?? DEFAULT_RUNTIME_PROFILE,
    internetPolicy: input.internetPolicy ?? DEFAULT_INTERNET_POLICY,
    source: input.source ?? { type: "empty" },
    baseCommit: input.baseCommit ?? null,
    currentCommit: input.currentCommit ?? null,
    defaultBranch: input.defaultBranch ?? null,
    workingBranch: input.workingBranch ?? null,
  } satisfies Workspace;

  return workspaceSchema.parse(workspace);
}

export function updateWorkspaceStatus(
  workspace: Workspace,
  { status, updatedAt = new Date() }: UpdateWorkspaceStatusOptions,
): Workspace {
  return workspaceSchema.parse({
    ...workspace,
    status,
    updatedAt: toIsoDateTime(updatedAt),
  });
}

export function markWorkspaceDeleted(
  workspace: Workspace,
  { deletedAt = new Date() }: MarkWorkspaceDeletedOptions = {},
): Workspace {
  return updateWorkspaceStatus(workspace, {
    status: "deleted",
    updatedAt: deletedAt,
  });
}

function defaultWorkspaceName(workspaceId: string): string {
  return `Workspace ${workspaceId}`;
}

function calculateExpiresAt(now: Date, ttlMinutes: number | undefined): string | null {
  if (ttlMinutes === undefined) {
    return null;
  }

  const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);
  return toIsoDateTime(expiresAt);
}

function toIsoDateTime(date: Date): string {
  return date.toISOString();
}
