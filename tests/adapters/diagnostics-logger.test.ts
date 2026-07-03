import test from "node:test";
import assert from "node:assert/strict";
import pino from "pino";
import { PinoDiagnosticsLogger } from "../../src/adapters/logging/index.ts";
import { createLiteralSecretMasker } from "../../src/security/log-masking.ts";

test("PinoDiagnosticsLogger masks diagnostics metadata without creating audit events", () => {
  const lines: string[] = [];
  const stream = { write: (line: string) => { lines.push(line); } };
  const logger = new PinoDiagnosticsLogger({
    logger: pino({ level: "debug" }, stream),
    logMasker: createLiteralSecretMasker([{ name: "token", value: "secret-value" }]),
  });

  logger.info("token secret-value", { token: "secret-value", nested: { value: "secret-value" } });

  assert.equal(lines.length, 1);
  assert.match(lines[0] ?? "", /\[REDACTED_SECRET:token\]/);
  assert.doesNotMatch(lines[0] ?? "", /secret-value/);
  assert.doesNotMatch(lines[0] ?? "", /auditEventId/);
});
