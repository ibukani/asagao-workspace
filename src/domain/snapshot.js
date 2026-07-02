import {
  optionalString,
  requireNonEmptyString,
  toIsoTimestamp,
} from "./validation.js";

export function createSnapshotModel(input, { now = new Date() } = {}) {
  return Object.freeze({
    snapshotId: requireNonEmptyString(input.snapshotId, "snapshotId"),
    workspaceId: requireNonEmptyString(input.workspaceId, "workspaceId"),
    label: optionalString(input.label, "label"),
    source: optionalString(input.source, "source"),
    createdAt: toIsoTimestamp(input.createdAt ?? now, "createdAt"),
  });
}
