import { z, type ZodType } from "zod";

export const toolErrorCodeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/);

export const toolErrorSchema = z
  .object({
    code: toolErrorCodeSchema,
    message: z.string().min(1),
    details: z.unknown().optional(),
  })
  .strict();

export function createToolSuccessSchema<DataSchema extends ZodType>(dataSchema: DataSchema) {
  return z
    .object({
      ok: z.literal(true),
      data: dataSchema,
    })
    .strict();
}

export const toolFailureSchema = z
  .object({
    ok: z.literal(false),
    error: toolErrorSchema,
  })
  .strict();

export function createToolResponseSchema<DataSchema extends ZodType>(dataSchema: DataSchema) {
  return z.discriminatedUnion("ok", [
    createToolSuccessSchema(dataSchema),
    toolFailureSchema,
  ]);
}

export type ToolError = z.infer<typeof toolErrorSchema>;

export type ToolSuccess<Data> = {
  ok: true;
  data: Data;
};

export type ToolFailure = {
  ok: false;
  error: ToolError;
};

export type ToolResponse<Data> = ToolSuccess<Data> | ToolFailure;

export function toolSuccess<Data>(data: Data): ToolSuccess<Data> {
  return { ok: true, data };
}

export function toolError(
  code: string,
  message: string,
  details?: unknown,
): ToolFailure {
  const error = details === undefined ? { code, message } : { code, message, details };
  return { ok: false, error };
}
