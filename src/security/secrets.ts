import { z } from "zod";

export const secretNameSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z_][A-Za-z0-9_./:-]*$/);

export const secretPolicySchema = z
  .object({
    injectByDefault: z.literal(false),
    allowedSecretNames: z.array(secretNameSchema),
  })
  .strict();

export type SecretPolicy = z.infer<typeof secretPolicySchema>;

export const DEFAULT_SECRET_POLICY = secretPolicySchema.parse({
  injectByDefault: false,
  allowedSecretNames: [],
}) satisfies SecretPolicy;

export function createSecretPolicy(overrides: Partial<SecretPolicy> = {}): SecretPolicy {
  return secretPolicySchema.parse({
    ...DEFAULT_SECRET_POLICY,
    ...overrides,
    injectByDefault: false,
  });
}
