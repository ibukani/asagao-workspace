import test from "node:test";
import assert from "node:assert/strict";
import {
  InMemoryAuditEventRecorder,
  RunnerOperationDeniedError,
  allowDecision,
  auditEventSchema,
  createAuditEvent,
  createLiteralSecretMasker,
  denyDecision,
  runAuditedOperation,
  type RunnerOperationRequest,
} from "../src/security/index.ts";

const operation: RunnerOperationRequest = {
  workspaceId: "wks_audit001",
  operationKind: "command",
  action: "run_command",
  actor: "assistant",
  command: ["npm", "test"],
};

function fixedIdFactory() {
  let sequence = 0;
  return () => `aud_test00${++sequence}`;
}

test("audit event schema defines a common operation event shape", () => {
  const event = createAuditEvent(
    {
      operation,
      eventType: "policy_evaluated",
      decision: allowDecision("allowed for test"),
      metadata: { command: ["npm", "test"] },
    },
    {
      now: new Date("2026-07-02T12:00:00.000Z"),
      createAuditEventId: () => "aud_schema001",
    },
  );

  assert.deepEqual(auditEventSchema.parse(event), event);
  assert.equal(event.auditEventId, "aud_schema001");
  assert.equal(event.eventType, "policy_evaluated");
  assert.equal(event.decision, "allowed");
  assert.deepEqual(event.metadata, { command: ["npm", "test"] });
});

test("in-memory audit recorder stores and clears audit events", () => {
  const recorder = new InMemoryAuditEventRecorder();
  const event = createAuditEvent(
    {
      operation,
      eventType: "operation_started",
    },
    {
      now: new Date("2026-07-02T12:00:00.000Z"),
      createAuditEventId: () => "aud_memory001",
    },
  );

  recorder.record(event);
  assert.deepEqual(recorder.listEvents(), [event]);

  recorder.clear();
  assert.deepEqual(recorder.listEvents(), []);
});

test("runAuditedOperation records policy, start, and success events", async () => {
  const recorder = new InMemoryAuditEventRecorder();
  const result = await runAuditedOperation({
    recorder,
    operation,
    evaluatePolicy: () => allowDecision("allowed for test"),
    execute: () => "ok",
    now: () => new Date("2026-07-02T12:00:00.000Z"),
    createAuditEventId: fixedIdFactory(),
  });

  assert.equal(result, "ok");
  assert.deepEqual(
    recorder.listEvents().map((event) => event.eventType),
    ["policy_evaluated", "operation_started", "operation_succeeded"],
  );
});

test("runAuditedOperation records denial and does not execute denied operations", async () => {
  const recorder = new InMemoryAuditEventRecorder();
  let executed = false;

  await assert.rejects(
    () => runAuditedOperation({
      recorder,
      operation,
      evaluatePolicy: () => denyDecision("command_default_denied", "denied for test"),
      execute: () => {
        executed = true;
      },
      now: () => new Date("2026-07-02T12:00:00.000Z"),
      createAuditEventId: fixedIdFactory(),
    }),
    RunnerOperationDeniedError,
  );

  assert.equal(executed, false);
  assert.deepEqual(
    recorder.listEvents().map((event) => event.eventType),
    ["policy_evaluated", "operation_denied"],
  );
});

test("runAuditedOperation masks failure metadata through the configured log masker", async () => {
  const recorder = new InMemoryAuditEventRecorder();

  await assert.rejects(
    () => runAuditedOperation({
      recorder,
      operation,
      evaluatePolicy: () => allowDecision("allowed with token secret-token"),
      execute: () => {
        throw new Error("failed with secret-token");
      },
      now: () => new Date("2026-07-02T12:00:00.000Z"),
      createAuditEventId: fixedIdFactory(),
      logMasker: createLiteralSecretMasker([{ name: "TEST_TOKEN", value: "secret-token" }]),
    }),
    /failed with secret-token/,
  );

  const failure = recorder.listEvents().at(-1);
  assert.equal(failure?.eventType, "operation_failed");
  assert.equal(failure?.message, "Runner operation failed.");
  assert.deepEqual(failure?.metadata, {
    errorName: "Error",
    errorMessage: "failed with [REDACTED_SECRET:TEST_TOKEN]",
  });
});
