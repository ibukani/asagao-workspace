import { z, type ZodType } from "zod";
import {
  toolError,
  toolSuccess,
  type ToolResponse,
  type WorkspacePatchApplyData,
} from "../../domain/index.ts";
import {
  toWorkspacePatchToolFailure,
  WORKSPACE_PATCH_ERROR_CODES,
  type WorkspacePatchService,
} from "../../services/workspace-patch-service.ts";
import {
  applyPatchInputSchema,
  type ApplyPatchInput,
} from "./contracts.ts";

export type ApplyPatchResult = ToolResponse<WorkspacePatchApplyData>;

export async function buildApplyPatchResult(
  patchService: WorkspacePatchService,
  input: unknown,
): Promise<ApplyPatchResult> {
  const parsed = parsePatchInput(applyPatchInputSchema, input);
  if (!parsed.ok) {
    return parsed;
  }

  try {
    return toolSuccess(await patchService.applyPatch(parsed.data));
  } catch (error) {
    return toWorkspacePatchToolFailure(error);
  }
}

function parsePatchInput<Input>(schema: ZodType<Input>, input: unknown): ToolResponse<Input> {
  const parsed = schema.safeParse(input);

  if (parsed.success) {
    return toolSuccess(parsed.data);
  }

  return toolError(
    WORKSPACE_PATCH_ERROR_CODES.invalidInput,
    "Invalid workspace patch request.",
    { issues: z.treeifyError(parsed.error) },
  );
}

export type { ApplyPatchInput };
