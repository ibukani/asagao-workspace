import { z, type ZodType } from "zod";
import {
  toolError,
  toolSuccess,
  type CommandJob,
  type ToolResponse,
} from "../../domain/index.ts";
import {
  COMMAND_JOB_ERROR_CODES,
  toCommandJobToolFailure,
  type CommandJobService,
} from "../../services/command-job-service.ts";
import {
  getCommandStatusInputSchema,
  runCommandInputSchema,
  type GetCommandStatusInput,
  type RunCommandInput,
} from "./contracts.ts";

export type RunCommandResult = ToolResponse<CommandJob>;
export type GetCommandStatusResult = ToolResponse<CommandJob>;

export async function buildRunCommandResult(
  commandJobService: CommandJobService,
  input: unknown,
): Promise<RunCommandResult> {
  const parsed = parseCommandJobInput(runCommandInputSchema, input);
  if (!parsed.ok) {
    return parsed;
  }

  try {
    return toolSuccess(await commandJobService.runCommand(parsed.data));
  } catch (error) {
    return toCommandJobToolFailure(error);
  }
}

export async function buildGetCommandStatusResult(
  commandJobService: CommandJobService,
  input: unknown,
): Promise<GetCommandStatusResult> {
  const parsed = parseCommandJobInput(getCommandStatusInputSchema, input);
  if (!parsed.ok) {
    return parsed;
  }

  try {
    return toolSuccess(await commandJobService.getCommandStatus(parsed.data));
  } catch (error) {
    return toCommandJobToolFailure(error);
  }
}

function parseCommandJobInput<Input>(schema: ZodType<Input>, input: unknown): ToolResponse<Input> {
  const parsed = schema.safeParse(input);

  if (parsed.success) {
    return toolSuccess(parsed.data);
  }

  return toolError(
    COMMAND_JOB_ERROR_CODES.invalidInput,
    "Invalid command job request.",
    { issues: z.treeifyError(parsed.error) },
  );
}

export type { GetCommandStatusInput, RunCommandInput };
