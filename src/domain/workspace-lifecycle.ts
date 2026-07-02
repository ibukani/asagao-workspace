import { z } from "zod";
import { isoDateTimeSchema } from "./common.ts";
import { workspaceIdSchema, workspaceStatusSchema } from "./workspace.ts";

export const workspaceDirtyStates = ["clean", "dirty", "unknown"] as const;
export const workspaceBusyStates = ["idle", "busy"] as const;
export const workspaceLifecycleStates = [
  "creating",
  "ready",
  "reusable",
  "dirty",
  "busy",
  "expired",
  "failed",
  "deleted",
] as const;
export const workspaceLifecycleBlockers = [
  "workspace_not_ready",
  "workspace_failed",
  "workspace_deleted",
  "workspace_expired",
  "workspace_busy",
  "workspace_dirty",
  "dirty_state_unknown",
  "operation_not_implemented_in_phase1",
] as const;
export const workspaceLifecycleOperations = [
  "get_workspace_lifecycle",
  "claim_workspace",
  "reset_workspace",
  "clean_workspace",
] as const;

export const workspaceDirtyStateSchema = z.enum(workspaceDirtyStates);
export const workspaceBusyStateSchema = z.enum(workspaceBusyStates);
export const workspaceLifecycleStateSchema = z.enum(workspaceLifecycleStates);
export const workspaceLifecycleBlockerSchema = z.enum(workspaceLifecycleBlockers);
export const workspaceLifecycleOperationSchema = z.enum(workspaceLifecycleOperations);

export const workspaceLifecycleMetadataSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    dirtyState: workspaceDirtyStateSchema,
    busyState: workspaceBusyStateSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    lastClaimedAt: isoDateTimeSchema.nullable(),
    lastReusedAt: isoDateTimeSchema.nullable(),
    lastResetAt: isoDateTimeSchema.nullable(),
    lastCleanedAt: isoDateTimeSchema.nullable(),
  })
  .strict();

export const workspaceLifecycleSnapshotSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    workspaceStatus: workspaceStatusSchema,
    state: workspaceLifecycleStateSchema,
    reusable: z.boolean(),
    expired: z.boolean(),
    dirty: z.boolean(),
    dirtyState: workspaceDirtyStateSchema,
    busy: z.boolean(),
    busyState: workspaceBusyStateSchema,
    blockers: z.array(workspaceLifecycleBlockerSchema),
    evaluatedAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema.nullable(),
    lastClaimedAt: isoDateTimeSchema.nullable(),
    lastReusedAt: isoDateTimeSchema.nullable(),
    lastResetAt: isoDateTimeSchema.nullable(),
    lastCleanedAt: isoDateTimeSchema.nullable(),
  })
  .strict();

export const workspaceLifecycleDecisionSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    operation: workspaceLifecycleOperationSchema,
    accepted: z.boolean(),
    implemented: z.boolean(),
    lifecycle: workspaceLifecycleSnapshotSchema,
    blockers: z.array(workspaceLifecycleBlockerSchema),
    evaluatedAt: isoDateTimeSchema,
  })
  .strict();

export type WorkspaceDirtyState = z.infer<typeof workspaceDirtyStateSchema>;
export type WorkspaceBusyState = z.infer<typeof workspaceBusyStateSchema>;
export type WorkspaceLifecycleState = z.infer<typeof workspaceLifecycleStateSchema>;
export type WorkspaceLifecycleBlocker = z.infer<typeof workspaceLifecycleBlockerSchema>;
export type WorkspaceLifecycleOperation = z.infer<typeof workspaceLifecycleOperationSchema>;
export type WorkspaceLifecycleMetadata = z.infer<typeof workspaceLifecycleMetadataSchema>;
export type WorkspaceLifecycleSnapshot = z.infer<typeof workspaceLifecycleSnapshotSchema>;
export type WorkspaceLifecycleDecision = z.infer<typeof workspaceLifecycleDecisionSchema>;
