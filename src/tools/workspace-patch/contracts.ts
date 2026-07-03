import { z } from "zod";
import {
  createToolResponseSchema,
  toolFailureSchema,
  workspaceIdSchema,
  workspacePatchApplyDataSchema,
  workspacePatchModeSchema,
} from "../../domain/index.ts";

export const APPLY_PATCH_TOOL_NAME = "apply_patch";

export const WORKSPACE_PATCH_TOOL_NAMES = [
  APPLY_PATCH_TOOL_NAME,
] as const;

export const applyPatchInputSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    patch: z.string().min(1),
    expectedBaseCommit: z.string().min(1).optional(),
    mode: workspacePatchModeSchema.default("apply"),
  })
  .strict();

export const applyPatchOutputSchema = createToolResponseSchema(workspacePatchApplyDataSchema);

export const workspacePatchContracts = {
  [APPLY_PATCH_TOOL_NAME]: {
    name: APPLY_PATCH_TOOL_NAME,
    inputSchema: applyPatchInputSchema,
    outputSchema: applyPatchOutputSchema,
  },
} as const;

export const workspacePatchFailureOutputSchema = toolFailureSchema;

export type ApplyPatchInput = z.infer<typeof applyPatchInputSchema>;
