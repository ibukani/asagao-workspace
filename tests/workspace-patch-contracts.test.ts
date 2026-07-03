import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPatchInputSchema,
  applyPatchOutputSchema,
  workspacePatchContracts,
} from "../src/tools/workspace-patch/contracts.ts";

const validPatch = [
  "diff --git a/README.md b/README.md",
  "--- a/README.md",
  "+++ b/README.md",
  "@@ -1 +1,2 @@",
  " hello",
  "+patched",
  "",
].join("\n");

test("apply_patch contract parses defaults and rejects unknown input", () => {
  const parsed = applyPatchInputSchema.parse({
    workspaceId: "wks_patchcontracts001",
    patch: validPatch,
  });

  assert.equal(parsed.mode, "apply");
  assert.equal(applyPatchInputSchema.parse({
    workspaceId: "wks_patchcontracts001",
    patch: "",
  }).patch, "");
  assert.equal(applyPatchInputSchema.safeParse({
    workspaceId: "wks_patchcontracts001",
    patch: validPatch,
    extra: true,
  }).success, false);
  assert.equal(workspacePatchContracts.apply_patch.name, "apply_patch");
});

test("apply_patch output contract accepts applied and preflight failure data", () => {
  const base = {
    patchId: "pat_contract001",
    workspaceId: "wks_patchcontracts001",
    mode: "apply" as const,
    baseCommit: "abc123",
    resultingCommit: "abc123",
    checkedFiles: ["README.md"],
    checkedFilesTruncated: false,
    totalCheckedFiles: 1,
    changedFiles: [],
    changedFilesTruncated: false,
    totalChangedFiles: 0,
    diffstat: { filesChanged: 0, additions: 0, deletions: 0, binaryFiles: 0 },
    gitStatus: {
      workspaceId: "wks_patchcontracts001",
      clean: true,
      branch: "main",
      headCommit: "abc123",
      changedFiles: [],
      truncated: false,
      totalChangedFiles: 0,
      limits: { maxFiles: 500 },
    },
    snapshotCreated: false,
    snapshotPolicy: "deferred_to_issue_13" as const,
    limits: { maxFiles: 500, maxPatchBytes: 2_000_000 },
  };

  assert.equal(applyPatchOutputSchema.safeParse({
    ok: true,
    data: {
      ...base,
      applied: true,
      diagnostics: [{ code: "patch_applied", severity: "info", message: "Patch applied successfully." }],
    },
  }).success, true);
  assert.equal(applyPatchOutputSchema.safeParse({
    ok: true,
    data: {
      ...base,
      applied: false,
      diagnostics: [{ code: "invalid_patch", severity: "error", message: "Patch preflight failed." }],
    },
  }).success, true);
});
