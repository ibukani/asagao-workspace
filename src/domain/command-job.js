import {
  freezeArray,
  optionalAllowedValue,
  optionalIsoTimestamp,
  optionalNonNegativeInteger,
  optionalString,
  requireNonEmptyString,
  toIsoTimestamp,
} from "./validation.js";

export const COMMAND_JOB_STATUSES = Object.freeze([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
]);

export function createCommandJobModel(input, { now = new Date() } = {}) {
  const command = freezeArray(input.command, "command");
  validateCommand(command);

  return Object.freeze({
    jobId: requireNonEmptyString(input.jobId, "jobId"),
    workspaceId: requireNonEmptyString(input.workspaceId, "workspaceId"),
    status: optionalAllowedValue(
      input.status,
      COMMAND_JOB_STATUSES,
      "status",
      "queued",
    ),
    command,
    cwd: optionalString(input.cwd, "cwd"),
    createdAt: toIsoTimestamp(input.createdAt ?? now, "createdAt"),
    startedAt: optionalIsoTimestamp(input.startedAt, "startedAt"),
    finishedAt: optionalIsoTimestamp(input.finishedAt, "finishedAt"),
    exitCode: optionalExitCode(input.exitCode),
    timeoutMs: optionalNonNegativeInteger(input.timeoutMs, "timeoutMs"),
    logCursor: optionalString(input.logCursor, "logCursor"),
  });
}

function validateCommand(command) {
  if (command.length === 0) {
    throw new Error("command must contain at least one argument");
  }

  for (const [index, argument] of command.entries()) {
    requireNonEmptyString(argument, `command[${index}]`);
  }
}

function optionalExitCode(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (!Number.isInteger(value)) {
    throw new Error("exitCode must be an integer when provided");
  }

  return value;
}
