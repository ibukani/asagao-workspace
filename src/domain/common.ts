import { z } from "zod";

export const isoDateTimeSchema = z.string().datetime({ offset: true });

export function createPrefixedIdSchema(prefix: string): z.ZodString {
  return z
    .string()
    .regex(new RegExp(`^${prefix}_[A-Za-z0-9][A-Za-z0-9_-]{2,63}$`));
}
