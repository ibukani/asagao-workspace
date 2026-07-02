import {
  optionalAllowedValue,
  optionalIsoTimestamp,
  optionalObject,
  optionalString,
  requireNonEmptyString,
  toIsoTimestamp,
} from "./validation.js";

export const WORKSPACE_STATUSES = Object.freeze([
  "creating",
  "ready",
  "failed",
  "deleted",
]);

export const RUNTIME_PROFILES = Object.freeze([
  "generic",
  "node",
  "python",
  "rust",
]);

export const INTERNET_POLICIES = Object.freeze([
  "none",
  "package_registry",
  "full",
]);

export function createWorkspaceModel(input, { now = new Date() } = {}) {
  const createdAt = toIsoTimestamp(input.createdAt ?? now, "createdAt");

  return Object.freeze({
    workspaceId: requireNonEmptyString(input.workspaceId, "workspaceId"),
    workspaceName: optionalString(input.workspaceName, "workspaceName"),
    status: optionalAllowedValue(
      input.status,
      WORKSPACE_STATUSES,
      "status",
      "creating",
    ),
    source: optionalObject(input.source, "source"),
    baseCommit: optionalString(input.baseCommit, "baseCommit"),
    currentCommit: optionalString(input.currentCommit, "currentCommit"),
    defaultBranch: optionalString(input.defaultBranch, "defaultBranch"),
    workingBranch: optionalString(input.workingBranch, "workingBranch"),
    runtimeProfile: optionalAllowedValue(
      input.runtimeProfile,
      RUNTIME_PROFILES,
      "runtimeProfile",
      "generic",
    ),
    internetPolicy: optionalAllowedValue(
      input.internetPolicy,
      INTERNET_POLICIES,
      "internetPolicy",
      "none",
    ),
    createdAt,
    expiresAt: resolveExpiresAt(input, createdAt),
    deletedAt: optionalIsoTimestamp(input.deletedAt, "deletedAt"),
    failureReason: optionalString(input.failureReason, "failureReason"),
  });
}

export function markWorkspaceReady(workspace, patch = {}) {
  return createWorkspaceModel({
    ...workspace,
    ...patch,
    status: "ready",
    failureReason: null,
  });
}

export function markWorkspaceFailed(workspace, failureReason) {
  return createWorkspaceModel({
    ...workspace,
    status: "failed",
    failureReason: requireNonEmptyString(failureReason, "failureReason"),
  });
}

export function markWorkspaceDeleted(workspace, { deletedAt = new Date() } = {}) {
  return createWorkspaceModel({
    ...workspace,
    status: "deleted",
    deletedAt,
  });
}

function resolveExpiresAt(input, createdAt) {
  if (input.expiresAt !== undefined && input.expiresAt !== null) {
    return optionalIsoTimestamp(input.expiresAt, "expiresAt");
  }

  if (input.ttlMinutes === undefined || input.ttlMinutes === null) {
    return null;
  }

  if (!Number.isInteger(input.ttlMinutes) || input.ttlMinutes <= 0) {
    throw new Error("ttlMinutes must be a positive integer when provided");
  }

  return new Date(new Date(createdAt).getTime() + input.ttlMinutes * 60_000)
    .toISOString();
}
