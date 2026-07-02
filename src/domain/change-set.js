import {
  freezeArray,
  optionalAllowedValue,
  optionalString,
  requireNonEmptyString,
} from "./validation.js";

export const CHANGE_SET_RISK_LEVELS = Object.freeze([
  "low",
  "medium",
  "high",
]);

export const CHANGED_FILE_STATUSES = Object.freeze([
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "unchanged",
]);

export function createChangedFileModel(input) {
  return Object.freeze({
    path: requireNonEmptyString(input.path, "path"),
    status: optionalAllowedValue(
      input.status,
      CHANGED_FILE_STATUSES,
      "status",
      "modified",
    ),
    previousPath: optionalString(input.previousPath, "previousPath"),
    additions: normalizeCount(input.additions, "additions"),
    deletions: normalizeCount(input.deletions, "deletions"),
  });
}

export function createDiffStatModel(input = {}) {
  return Object.freeze({
    filesChanged: normalizeCount(input.filesChanged, "filesChanged"),
    insertions: normalizeCount(input.insertions, "insertions"),
    deletions: normalizeCount(input.deletions, "deletions"),
  });
}

export function createChangeSetModel(input) {
  return Object.freeze({
    changeSetId: requireNonEmptyString(input.changeSetId, "changeSetId"),
    workspaceId: requireNonEmptyString(input.workspaceId, "workspaceId"),
    baseCommit: optionalString(input.baseCommit, "baseCommit"),
    changedFiles: freezeArray(input.changedFiles, "changedFiles")
      .map((file) => createChangedFileModel(file)),
    diffstat: createDiffStatModel(input.diffstat),
    patchArtifactId: optionalString(input.patchArtifactId, "patchArtifactId"),
    testEvidence: freezeArray(input.testEvidence, "testEvidence"),
    generatedArtifacts: freezeArray(input.generatedArtifacts, "generatedArtifacts"),
    suggestedCommitMessage: optionalString(
      input.suggestedCommitMessage,
      "suggestedCommitMessage",
    ),
    suggestedPullRequestBody: optionalString(
      input.suggestedPullRequestBody,
      "suggestedPullRequestBody",
    ),
    riskLevel: input.riskLevel === undefined || input.riskLevel === null
      ? null
      : optionalAllowedValue(
          input.riskLevel,
          CHANGE_SET_RISK_LEVELS,
          "riskLevel",
          "medium",
        ),
  });
}

function normalizeCount(value, fieldName) {
  const count = value ?? 0;
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }

  return count;
}
