import { z } from "zod";

export const policyDecisionOutcomes = ["allowed", "denied"] as const;

export const policyReasonCodeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/);

export const policyDecisionSchema = z
  .object({
    outcome: z.enum(policyDecisionOutcomes),
    reasonCode: policyReasonCodeSchema.optional(),
    message: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((decision, context) => {
    if (decision.outcome === "denied" && decision.reasonCode === undefined) {
      context.addIssue({
        code: "custom",
        path: ["reasonCode"],
        message: "denied decisions require a reasonCode",
      });
    }
  });

export type PolicyDecisionOutcome = z.infer<typeof policyDecisionSchema>["outcome"];
export type PolicyDecision = z.infer<typeof policyDecisionSchema>;

export function allowDecision(message?: string): PolicyDecision {
  return policyDecisionSchema.parse({
    outcome: "allowed",
    ...(message === undefined ? {} : { message }),
  });
}

export function denyDecision(reasonCode: string, message: string): PolicyDecision {
  return policyDecisionSchema.parse({
    outcome: "denied",
    reasonCode,
    message,
  });
}

export function isAllowedDecision(decision: PolicyDecision): boolean {
  return decision.outcome === "allowed";
}
