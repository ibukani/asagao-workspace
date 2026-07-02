import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createPrefixedIdSchema, isoDateTimeSchema } from "../domain/common.ts";
import {
  runnerOperationActionSchema,
  runnerOperationKindSchema,
  runnerOperationRequestSchema,
  securityActorSchema,
  type RunnerOperationRequest,
} from "./policy.ts";
import {
  isAllowedDecision,
  policyDecisionSchema,
  type PolicyDecision,
} from "./decision.ts";
import {
  maskStructuredValue,
  passthroughLogMasker,
  type LogMasker,
} from "./log-masking.ts";

export const auditEventTypes = [
  "policy_evaluated",
  "operation_started",
  "operation_succeeded",
  "operation_failed",
  "operation_denied",
] as const;

export const auditEventIdSchema = createPrefixedIdSchema("aud");
export const auditEventTypeSchema = z.enum(auditEventTypes);

export const auditEventSchema = z
  .object({
    auditEventId: auditEventIdSchema,
    timestamp: isoDateTimeSchema,
    workspaceId: z.string().nullable(),
    operationKind: runnerOperationKindSchema,
    action: runnerOperationActionSchema,
    eventType: auditEventTypeSchema,
    actor: securityActorSchema,
    decision: policyDecisionSchema.shape.outcome.optional(),
    reasonCode: policyDecisionSchema.shape.reasonCode.optional(),
    message: z.string().min(1).optional(),
    metadata: z.record(z.string(), z.unknown()),
  })
  .strict();

export type AuditEventType = z.infer<typeof auditEventTypeSchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
export type AuditEventIdFactory = () => string;
export type AuditClock = () => Date;

export type AuditEventRecorder = {
  record: (event: AuditEvent) => void | Promise<void>;
};

export type CreateAuditEventInput = {
  operation: RunnerOperationRequest;
  eventType: AuditEventType;
  decision?: PolicyDecision;
  message?: string;
  metadata?: Record<string, unknown>;
};

export type CreateAuditEventOptions = {
  now?: Date;
  createAuditEventId?: AuditEventIdFactory;
  logMasker?: LogMasker;
};

export class NoopAuditEventRecorder implements AuditEventRecorder {
  record(): void {}
}

export class InMemoryAuditEventRecorder implements AuditEventRecorder {
  readonly #events: AuditEvent[] = [];

  record(event: AuditEvent): void {
    this.#events.push(event);
  }

  listEvents(): AuditEvent[] {
    return [...this.#events];
  }

  clear(): void {
    this.#events.length = 0;
  }
}

export class RunnerOperationDeniedError extends Error {
  readonly decision: PolicyDecision;
  readonly operation: RunnerOperationRequest;

  constructor(decision: PolicyDecision, operation: RunnerOperationRequest) {
    super(decision.message ?? "Runner operation denied by policy.");
    this.name = "RunnerOperationDeniedError";
    this.decision = decision;
    this.operation = operation;
  }
}

export type RunAuditedOperationInput<Result> = {
  recorder: AuditEventRecorder;
  operation: RunnerOperationRequest;
  evaluatePolicy: () => PolicyDecision | Promise<PolicyDecision>;
  execute: () => Result | Promise<Result>;
  now?: AuditClock;
  createAuditEventId?: AuditEventIdFactory;
  logMasker?: LogMasker;
};

export function createAuditEvent(
  input: CreateAuditEventInput,
  {
    now = new Date(),
    createAuditEventId = createDefaultAuditEventId,
    logMasker = passthroughLogMasker,
  }: CreateAuditEventOptions = {},
): AuditEvent {
  const metadata = maskStructuredValue(input.metadata ?? {}, logMasker);
  const message = input.message ?? input.decision?.message;

  return auditEventSchema.parse({
    auditEventId: createAuditEventId(),
    timestamp: now.toISOString(),
    workspaceId: input.operation.workspaceId,
    operationKind: input.operation.operationKind,
    action: input.operation.action,
    eventType: input.eventType,
    actor: input.operation.actor,
    ...(input.decision === undefined ? {} : { decision: input.decision.outcome }),
    ...(input.decision?.reasonCode === undefined ? {} : { reasonCode: input.decision.reasonCode }),
    ...(message === undefined ? {} : { message: logMasker.maskText(message) }),
    metadata,
  });
}

export async function runAuditedOperation<Result>({
  recorder,
  operation,
  evaluatePolicy,
  execute,
  now = () => new Date(),
  createAuditEventId = createDefaultAuditEventId,
  logMasker = passthroughLogMasker,
}: RunAuditedOperationInput<Result>): Promise<Result> {
  const parsedOperation = runnerOperationRequestSchema.parse(operation);
  const createEvent = (
    input: Omit<CreateAuditEventInput, "operation">,
  ): AuditEvent => createAuditEvent(
    {
      operation: parsedOperation,
      ...input,
    },
    {
      now: now(),
      createAuditEventId,
      logMasker,
    },
  );

  const decision = await evaluatePolicy();
  await recorder.record(createEvent({ eventType: "policy_evaluated", decision }));

  if (!isAllowedDecision(decision)) {
    await recorder.record(createEvent({ eventType: "operation_denied", decision }));
    throw new RunnerOperationDeniedError(decision, parsedOperation);
  }

  await recorder.record(createEvent({ eventType: "operation_started", decision }));

  try {
    const result = await execute();
    await recorder.record(createEvent({ eventType: "operation_succeeded", decision }));
    return result;
  } catch (error) {
    await recorder.record(
      createEvent({
        eventType: "operation_failed",
        decision,
        message: "Runner operation failed.",
        metadata: {
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      }),
    );
    throw error;
  }
}

export function createDefaultAuditEventId(): string {
  return `aud_${randomUUID()}`;
}
