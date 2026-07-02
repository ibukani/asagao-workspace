import { z } from "zod";
import { createPrefixedIdSchema, isoDateTimeSchema } from "./common.ts";
import { workspaceIdSchema } from "./workspace.ts";

export const commandJobStatuses = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled",
  "timed_out",
] as const;

export const commandJobStatusSchema = z.enum(commandJobStatuses);
export const commandJobIdSchema = createPrefixedIdSchema("job");

export const commandJobSchema = z
  .object({
    jobId: commandJobIdSchema,
    workspaceId: workspaceIdSchema,
    status: commandJobStatusSchema,
    command: z.array(z.string().min(1)).min(1),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    exitCode: z.number().int().nullable(),
  })
  .strict();

export type CommandJobStatus = z.infer<typeof commandJobStatusSchema>;
export type CommandJob = z.infer<typeof commandJobSchema>;
