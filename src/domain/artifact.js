import {
  optionalAllowedValue,
  optionalNonNegativeInteger,
  optionalString,
  requireNonEmptyString,
  toIsoTimestamp,
} from "./validation.js";

export const ARTIFACT_KINDS = Object.freeze([
  "patch",
  "archive",
  "log",
  "diff",
  "generic",
]);

export function createArtifactRefModel(input, { now = new Date() } = {}) {
  return Object.freeze({
    artifactId: requireNonEmptyString(input.artifactId, "artifactId"),
    workspaceId: requireNonEmptyString(input.workspaceId, "workspaceId"),
    kind: optionalAllowedValue(input.kind, ARTIFACT_KINDS, "kind", "generic"),
    name: requireNonEmptyString(input.name, "name"),
    mimeType: optionalString(input.mimeType, "mimeType"),
    sizeBytes: optionalNonNegativeInteger(input.sizeBytes, "sizeBytes"),
    sha256: optionalString(input.sha256, "sha256"),
    uri: optionalString(input.uri, "uri"),
    createdAt: toIsoTimestamp(input.createdAt ?? now, "createdAt"),
  });
}
