import test from "node:test";
import assert from "node:assert/strict";
import {
  getCommandStatusInputSchema,
  getCommandStatusOutputSchema,
  runCommandInputSchema,
  runCommandOutputSchema,
} from "../src/tools/command-job/contracts.ts";
import { createQueuedCommandJobModel, toolSuccess } from "../src/domain/index.ts";

const job = createQueuedCommandJobModel({
  jobId: "job_contract001",
  workspaceId: "wks_contract001",
  command: ["node", "--version"],
  cwd: ".",
  timeoutMs: 1_000,
}, { now: new Date("2026-07-02T12:00:00.000Z") });

test("command job tool contracts accept fixed argument command input", () => {
  assert.equal(runCommandInputSchema.safeParse({
    workspaceId: "wks_contract001",
    command: ["node", "--version"],
    timeoutMs: 1_000,
  }).success, true);

  assert.equal(runCommandInputSchema.safeParse({
    workspaceId: "wks_contract001",
    command: "node --version",
    timeoutMs: 1_000,
  }).success, false);

  assert.equal(runCommandInputSchema.safeParse({
    workspaceId: "wks_contract001",
    command: ["node", "--version"],
  }).success, false);
});

test("command job tool contracts expose stable status response envelopes", () => {
  assert.equal(runCommandOutputSchema.safeParse(toolSuccess(job)).success, true);
  assert.equal(getCommandStatusOutputSchema.safeParse(toolSuccess({
    ...job,
    status: "succeeded",
    startedAt: "2026-07-02T12:00:00.000Z",
    finishedAt: "2026-07-02T12:00:01.000Z",
    elapsedMs: 1_000,
    exitCode: 0,
  })).success, true);
  assert.equal(getCommandStatusInputSchema.safeParse({
    workspaceId: "wks_contract001",
    jobId: "job_contract001",
  }).success, true);
});
