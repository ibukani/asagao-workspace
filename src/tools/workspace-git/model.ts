import { z, type ZodType } from "zod";
import {
  toolError,
  toolSuccess,
  type ToolResponse,
  type WorkspaceDiffData,
  type WorkspaceGitStatusData,
} from "../../domain/index.ts";
import {
  toWorkspaceGitToolFailure,
  WORKSPACE_GIT_ERROR_CODES,
  type WorkspaceGitService,
} from "../../services/workspace-git-service.ts";
import {
  getGitStatusInputSchema,
  getWorkspaceDiffInputSchema,
  type GetGitStatusInput,
  type GetWorkspaceDiffInput,
} from "./contracts.ts";

export type GetGitStatusResult = ToolResponse<WorkspaceGitStatusData>;
export type GetWorkspaceDiffResult = ToolResponse<WorkspaceDiffData>;

export async function buildGetGitStatusResult(
  gitService: WorkspaceGitService,
  input: unknown,
): Promise<GetGitStatusResult> {
  const parsed = parseGitInput(getGitStatusInputSchema, input);
  if (!parsed.ok) {
    return parsed;
  }

  try {
    return toolSuccess(await gitService.getGitStatus(parsed.data));
  } catch (error) {
    return toWorkspaceGitToolFailure(error);
  }
}

export async function buildGetWorkspaceDiffResult(
  gitService: WorkspaceGitService,
  input: unknown,
): Promise<GetWorkspaceDiffResult> {
  const parsed = parseGitInput(getWorkspaceDiffInputSchema, input);
  if (!parsed.ok) {
    return parsed;
  }

  try {
    return toolSuccess(await gitService.getWorkspaceDiff(parsed.data));
  } catch (error) {
    return toWorkspaceGitToolFailure(error);
  }
}

function parseGitInput<Input>(schema: ZodType<Input>, input: unknown): ToolResponse<Input> {
  const parsed = schema.safeParse(input);

  if (parsed.success) {
    return toolSuccess(parsed.data);
  }

  return toolError(
    WORKSPACE_GIT_ERROR_CODES.invalidInput,
    "Invalid workspace git request.",
    { issues: z.treeifyError(parsed.error) },
  );
}

export type {
  GetGitStatusInput,
  GetWorkspaceDiffInput,
};
