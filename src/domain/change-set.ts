import { z } from "zod";
import { createPrefixedIdSchema, isoDateTimeSchema } from "./common.ts";
import { workspaceIdSchema } from "./workspace.ts";

export const changeSetStatuses = [
  "pending",
  "ready",
  "applied",
  "failed",
  "discarded",
] as const;

export const changeSetStatusSchema = z.enum(changeSetStatuses);
export const changeSetIdSchema = createPrefixedIdSchema("chg");

export const changeSetSchema = z
  .object({
    changeSetId: changeSetIdSchema,
    workspaceId: workspaceIdSchema,
    status: changeSetStatusSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export type ChangeSetStatus = z.infer<typeof changeSetStatusSchema>;
export type ChangeSet = z.infer<typeof changeSetSchema>;
