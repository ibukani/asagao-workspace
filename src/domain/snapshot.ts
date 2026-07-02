import { z } from "zod";
import { createPrefixedIdSchema, isoDateTimeSchema } from "./common.ts";
import { workspaceIdSchema } from "./workspace.ts";

export const snapshotIdSchema = createPrefixedIdSchema("snp");

export const snapshotSchema = z
  .object({
    snapshotId: snapshotIdSchema,
    workspaceId: workspaceIdSchema,
    createdAt: isoDateTimeSchema,
    label: z.string().min(1).nullable(),
  })
  .strict();

export type Snapshot = z.infer<typeof snapshotSchema>;
