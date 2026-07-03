import test from "node:test";
import assert from "node:assert/strict";
import { createQueuedCommandJobModel } from "../src/domain/index.ts";
import { InMemoryCommandJobStore } from "../src/storage/in-memory-command-job-store.ts";

const now = new Date("2026-07-02T12:00:00.000Z");

test("InMemoryCommandJobStore saves immutable command job snapshots", () => {
  const store = new InMemoryCommandJobStore();
  const job = createQueuedCommandJobModel({
    jobId: "job_store001",
    workspaceId: "wks_store001",
    command: ["node", "--version"],
    cwd: ".",
    timeoutMs: 1_000,
  }, { now });

  const saved = store.save(job);
  saved.command.push("mutated");

  assert.deepEqual(store.get("job_store001")?.command, ["node", "--version"]);
  assert.equal(store.get("missing"), null);
});

test("InMemoryCommandJobStore filters by workspace and status", () => {
  const store = new InMemoryCommandJobStore();
  const first = createQueuedCommandJobModel({
    jobId: "job_store001",
    workspaceId: "wks_store001",
    command: ["node", "--version"],
    cwd: ".",
    timeoutMs: 1_000,
  }, { now });
  const second = createQueuedCommandJobModel({
    jobId: "job_store002",
    workspaceId: "wks_store002",
    command: ["node", "--version"],
    cwd: ".",
    timeoutMs: 1_000,
  }, { now });

  store.save(first);
  store.save({ ...second, status: "running" });

  assert.deepEqual(store.list({ workspaceId: "wks_store001" }).map((job) => job.jobId), ["job_store001"]);
  assert.deepEqual(store.list({ status: ["running"] }).map((job) => job.jobId), ["job_store002"]);
});
