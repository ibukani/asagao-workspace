import test from "node:test";
import assert from "node:assert/strict";
import { PQueueJobQueue } from "../../src/adapters/queue/index.ts";

test("PQueueJobQueue serializes jobs for the same workspace", async () => {
  const queue = new PQueueJobQueue({ concurrency: 2, perWorkspaceConcurrency: 1 });
  const events: string[] = [];

  await Promise.all([
    queue.add(async () => {
      events.push("a:start");
      await delay(20);
      events.push("a:end");
    }, { workspaceId: "wks_queue001" }),
    queue.add(async () => {
      events.push("b:start");
      await delay(1);
      events.push("b:end");
    }, { workspaceId: "wks_queue001" }),
  ]);

  assert.deepEqual(events, ["a:start", "a:end", "b:start", "b:end"]);
});

test("PQueueJobQueue allows different workspaces to run concurrently", async () => {
  const queue = new PQueueJobQueue({ concurrency: 2, perWorkspaceConcurrency: 1 });
  const events: string[] = [];

  await Promise.all([
    queue.add(async () => {
      events.push("a:start");
      await delay(20);
      events.push("a:end");
    }, { workspaceId: "wks_queue001" }),
    queue.add(async () => {
      events.push("b:start");
      await delay(1);
      events.push("b:end");
    }, { workspaceId: "wks_queue002" }),
  ]);

  assert.equal(events[0], "a:start");
  assert.equal(events.includes("b:start"), true);
  assert.ok(events.indexOf("b:start") < events.indexOf("a:end"));
  assert.deepEqual(queue.stats(), { pending: 0, running: 0, size: 0 });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
