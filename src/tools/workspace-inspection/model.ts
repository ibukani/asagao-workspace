import { z, type ZodType } from "zod";
import {
  toolError,
  toolSuccess,
  type ToolResponse,
  type WorkspaceFileTreeData,
  type WorkspaceReadFileData,
  type WorkspaceSearchData,
} from "../../domain/index.ts";
import {
  toWorkspaceInspectionToolFailure,
  WORKSPACE_INSPECTION_ERROR_CODES,
  type WorkspaceInspectionService,
} from "../../services/workspace-inspection-service.ts";
import {
  getFileTreeInputSchema,
  readFileInputSchema,
  searchWorkspaceInputSchema,
  type GetFileTreeInput,
  type ReadFileInput,
  type SearchWorkspaceInput,
} from "./contracts.ts";

export type GetFileTreeResult = ToolResponse<WorkspaceFileTreeData>;
export type ReadFileResult = ToolResponse<WorkspaceReadFileData>;
export type SearchWorkspaceResult = ToolResponse<WorkspaceSearchData>;

export async function buildGetFileTreeResult(
  inspectionService: WorkspaceInspectionService,
  input: unknown,
): Promise<GetFileTreeResult> {
  const parsed = parseInspectionInput(getFileTreeInputSchema, input ?? {});
  if (!parsed.ok) {
    return parsed;
  }

  try {
    return toolSuccess(await inspectionService.getFileTree(parsed.data));
  } catch (error) {
    return toWorkspaceInspectionToolFailure(error);
  }
}

export async function buildReadFileResult(
  inspectionService: WorkspaceInspectionService,
  input: unknown,
): Promise<ReadFileResult> {
  const parsed = parseInspectionInput(readFileInputSchema, input);
  if (!parsed.ok) {
    return parsed;
  }

  try {
    return toolSuccess(await inspectionService.readFile(parsed.data));
  } catch (error) {
    return toWorkspaceInspectionToolFailure(error);
  }
}

export async function buildSearchWorkspaceResult(
  inspectionService: WorkspaceInspectionService,
  input: unknown,
): Promise<SearchWorkspaceResult> {
  const parsed = parseInspectionInput(searchWorkspaceInputSchema, input);
  if (!parsed.ok) {
    return parsed;
  }

  try {
    return toolSuccess(await inspectionService.searchWorkspace(parsed.data));
  } catch (error) {
    return toWorkspaceInspectionToolFailure(error);
  }
}

function parseInspectionInput<Input>(
  schema: ZodType<Input>,
  input: unknown,
): ToolResponse<Input> {
  const parsed = schema.safeParse(input);

  if (parsed.success) {
    return toolSuccess(parsed.data);
  }

  return toolError(
    WORKSPACE_INSPECTION_ERROR_CODES.invalidInput,
    "Invalid workspace inspection request.",
    { issues: z.treeifyError(parsed.error) },
  );
}

export type {
  GetFileTreeInput,
  ReadFileInput,
  SearchWorkspaceInput,
};
