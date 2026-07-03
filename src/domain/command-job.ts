import { z } from "zod";
import { createPrefixedIdSchema, isoDateTimeSchema } from "./common.ts";
import { workspaceIdSchema } from "./workspace.ts";

export const commandJobStatuses = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
] as const;

export const commandFailureKinds = [
  "exit",
  "spawn",
  "timeout",
  "cancel",
  "max_buffer",
  "queue",
  "unknown",
] as const;

export const commandJobStatusSchema = z.enum(commandJobStatuses);
export const commandFailureKindSchema = z.enum(commandFailureKinds);
export const commandJobIdSchema = createPrefixedIdSchema("job");
export const commandArgvSchema = z
  .array(z.string().min(1).max(4096))
  .min(1)
  .max(128);

export const commandJobSchema = z
  .object({
    jobId: commandJobIdSchema,
    workspaceId: workspaceIdSchema,
    status: commandJobStatusSchema,
    command: commandArgvSchema,
    cwd: z.string().min(1),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    startedAt: isoDateTimeSchema.nullable(),
    finishedAt: isoDateTimeSchema.nullable(),
    timeoutMs: z.number().int().positive(),
    elapsedMs: z.number().int().nonnegative().nullable(),
    exitCode: z.number().int().nullable(),
    signal: z.string().min(1).nullable(),
    failureKind: commandFailureKindSchema.nullable(),
    stdout: z.string(),
    stderr: z.string(),
    stdoutBytes: z.number().int().nonnegative(),
    stderrBytes: z.number().int().nonnegative(),
    stdoutTruncated: z.boolean(),
    stderrTruncated: z.boolean(),
  })
  .strict();

export type CommandJobStatus = z.infer<typeof commandJobStatusSchema>;
export type CommandFailureKind = z.infer<typeof commandFailureKindSchema>;
export type CommandJob = z.infer<typeof commandJobSchema>;

export type CreateCommandJobModelInput = {
  jobId: string;
  workspaceId: string;
  command: readonly string[];
  cwd: string;
  timeoutMs: number;
};

export type CreateCommandJobModelOptions = {
  now?: Date;
};

export function createQueuedCommandJobModel(
  input: CreateCommandJobModelInput,
  { now = new Date() }: CreateCommandJobModelOptions = {},
): CommandJob {
  const timestamp = now.toISOString();

  return commandJobSchema.parse({
    jobId: input.jobId,
    workspaceId: input.workspaceId,
    status: "queued",
    command: [...input.command],
    cwd: input.cwd,
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: null,
    finishedAt: null,
    timeoutMs: input.timeoutMs,
    elapsedMs: null,
    exitCode: null,
    signal: null,
    failureKind: null,
    stdout: "",
    stderr: "",
    stdoutBytes: 0,
    stderrBytes: 0,
    stdoutTruncated: false,
    stderrTruncated: false,
  });
}
