import { z } from "zod";
import {
  commandArgvSchema,
  commandJobSchema,
  commandJobIdSchema,
  createToolResponseSchema,
  toolFailureSchema,
  workspaceIdSchema,
} from "../../domain/index.ts";

export const RUN_COMMAND_TOOL_NAME = "run_command";
export const GET_COMMAND_STATUS_TOOL_NAME = "get_command_status";

export const COMMAND_JOB_TOOL_NAMES = [
  RUN_COMMAND_TOOL_NAME,
  GET_COMMAND_STATUS_TOOL_NAME,
] as const;

export const runCommandInputSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    command: commandArgvSchema,
    cwd: z.string().min(1).max(4096).optional(),
    timeoutMs: z.number().int().positive(),
  })
  .strict();

export const getCommandStatusInputSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    jobId: commandJobIdSchema,
  })
  .strict();

export const runCommandOutputSchema = createToolResponseSchema(commandJobSchema);
export const getCommandStatusOutputSchema = createToolResponseSchema(commandJobSchema);

export const commandJobContracts = {
  [RUN_COMMAND_TOOL_NAME]: {
    name: RUN_COMMAND_TOOL_NAME,
    inputSchema: runCommandInputSchema,
    outputSchema: runCommandOutputSchema,
  },
  [GET_COMMAND_STATUS_TOOL_NAME]: {
    name: GET_COMMAND_STATUS_TOOL_NAME,
    inputSchema: getCommandStatusInputSchema,
    outputSchema: getCommandStatusOutputSchema,
  },
} as const;

export const commandJobFailureOutputSchema = toolFailureSchema;

export type RunCommandInput = z.infer<typeof runCommandInputSchema>;
export type GetCommandStatusInput = z.infer<typeof getCommandStatusInputSchema>;
