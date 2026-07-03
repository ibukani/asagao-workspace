import test from "node:test";
import assert from "node:assert/strict";
import { ExecaProcessRunner } from "../../src/adapters/process/index.ts";

const runner = new ExecaProcessRunner();

test("ExecaProcessRunner executes argument arrays and captures output", async () => {
  const result = await runner.run({
    executable: process.execPath,
    args: ["-e", "process.stdout.write('hello')"],
    maxStdoutBytes: 100,
  });

  assert.equal(result.failed, false);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "hello");
  assert.deepEqual(result.command, [process.execPath, "-e", "process.stdout.write('hello')"]);
});

test("ExecaProcessRunner reports non-zero exits as structured results", async () => {
  const result = await runner.run({
    executable: process.execPath,
    args: ["-e", "process.stderr.write('bad'); process.exit(7)"],
    maxStderrBytes: 100,
  });

  assert.equal(result.failed, true);
  assert.equal(result.failureKind, "exit");
  assert.equal(result.exitCode, 7);
  assert.equal(result.stderr, "bad");
});

test("ExecaProcessRunner marks timeout as structured metadata", async () => {
  const result = await runner.run({
    executable: process.execPath,
    args: ["-e", "setTimeout(() => {}, 1000)"],
    timeoutMs: 25,
  });

  assert.equal(result.failed, true);
  assert.equal(result.failureKind, "timeout");
  assert.equal(result.timedOut, true);
});

test("ExecaProcessRunner marks cancel signals as structured metadata", async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 25);

  const result = await runner.run({
    executable: process.execPath,
    args: ["-e", "setTimeout(() => {}, 1000)"],
    cancelSignal: controller.signal,
    timeoutMs: 1_000,
  });

  assert.equal(result.failed, true);
  assert.equal(result.failureKind, "cancel");
  assert.equal(result.cancelled, true);
  assert.equal(result.timedOut, false);
});

test("ExecaProcessRunner truncates bounded output", async () => {
  const result = await runner.run({
    executable: process.execPath,
    args: ["-e", "process.stdout.write('abcdef')"],
    maxStdoutBytes: 3,
  });

  assert.equal(result.failed, false);
  assert.equal(result.stdout, "abc");
  assert.equal(result.stdoutTruncated, true);
});

test("ExecaProcessRunner reports spawn failures without throwing library errors", async () => {
  const result = await runner.run({
    executable: "asagao-definitely-missing-command",
    args: [],
    timeoutMs: 25,
  });

  assert.equal(result.failed, true);
  assert.equal(result.failureKind, "spawn");
  assert.equal(result.exitCode, null);
});

test("ExecaProcessRunner can pipe bounded stdin without exposing stdin in results", async () => {
  const result = await runner.run({
    executable: process.execPath,
    args: ["-e", "process.stdin.pipe(process.stdout)"],
    stdin: "from stdin",
    maxStdoutBytes: 100,
  });

  assert.equal(result.failed, false);
  assert.equal(result.stdout, "from stdin");
  assert.equal(JSON.stringify(result).includes("from stdin"), true);
  assert.equal(result.command.includes("from stdin"), false);
});
