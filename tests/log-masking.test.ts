import test from "node:test";
import assert from "node:assert/strict";
import {
  composeLogMaskers,
  createLiteralSecretMasker,
  maskStructuredValue,
  passthroughLogMasker,
} from "../src/security/index.ts";

test("literal secret masker redacts configured secret values", () => {
  const masker = createLiteralSecretMasker([
    { name: "API_TOKEN", value: "token-123" },
    { value: "plain-secret" },
  ]);

  assert.equal(
    masker.maskText("token-123 and plain-secret"),
    "[REDACTED_SECRET:API_TOKEN] and [REDACTED_SECRET]",
  );
});

test("log maskers can be composed and applied to structured metadata", () => {
  const masker = composeLogMaskers([
    createLiteralSecretMasker([{ name: "FIRST", value: "first-secret" }]),
    createLiteralSecretMasker([{ name: "SECOND", value: "second-secret" }]),
  ]);

  assert.deepEqual(
    maskStructuredValue({
      message: "first-secret",
      nested: ["second-secret", 123, null],
    }, masker),
    {
      message: "[REDACTED_SECRET:FIRST]",
      nested: ["[REDACTED_SECRET:SECOND]", 123, null],
    },
  );
});

test("empty masker composition is passthrough", () => {
  assert.equal(composeLogMaskers([]), passthroughLogMasker);
  assert.equal(passthroughLogMasker.maskText("unchanged"), "unchanged");
});
