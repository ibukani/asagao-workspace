import test from "node:test";
import assert from "node:assert/strict";
import type { CommandJob } from "../src/domain/index.ts";
import type { CommandJobService } from "../src/services/command-job-service.ts";
import { createQueuedCommandJobModel } from "../src/domain/index.ts";
import {
  buildGetCommandStatusResult,
  buildRunCommandResult,
} from "../src/tools/command-job/model.ts";

const job = createQueuedCommandJobModel({
  jobId: "job_tools001",
  workspaceId: "wks_tools001",
  command: ["node", "--version"],
  cwd: ".",
  timeoutMs: 1_000,
}, { now: new Date("2026-07-02T12:00:00.000Z") });

test("command job tool model delegates valid run_command requests", async () => {
  const service = new FakeCommandJobService(job);

  const result = await buildRunCommandResult(service as unknown as CommandJobService, {
    workspaceId: "wks_tools001",
    command: ["node", "--version"],
    timeoutMs: 1_000,
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.data.jobId : undefined, "job_tools001");
  assert.deepEqual(service.runInputs, [{
    workspaceId: "wks_tools001",
    command: ["node", "--version"],
    timeoutMs: 1_000,
  }]);
});

test("command job tool model rejects shell string input before service execution", async () => {
  const service = new FakeCommandJobService(job);

  const result = await buildRunCommandResult(service as unknown as CommandJobService, {
    workspaceId: "wks_tools001",
    command: "node --version",
    timeoutMs: 1_000,
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok ? undefined : result.error.code, "invalid_input");
  assert.deepEqual(service.runInputs, []);
});

test("command job tool model delegates get_command_status requests", async () => {
  const service = new FakeCommandJobService({ ...job, status: "running" });

  const result = await buildGetCommandStatusResult(service as unknown as CommandJobService, {
    workspaceId: "wks_tools001",
    jobId: "job_tools001",
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.data.status : undefined, "running");
  assert.deepEqual(service.statusInputs, [{ workspaceId: "wks_tools001", jobId: "job_tools001" }]);
});

class FakeCommandJobService {
  readonly runInputs: unknown[] = [];
  readonly statusInputs: unknown[] = [];
  readonly response: CommandJob;

  constructor(response: CommandJob) {
    this.response = response;
  }

  async runCommand(input: unknown): Promise<CommandJob> {
    this.runInputs.push(input);
    return this.response;
  }

  async getCommandStatus(input: unknown): Promise<CommandJob> {
    this.statusInputs.push(input);
    return this.response;
  }
}
