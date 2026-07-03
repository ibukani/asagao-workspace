import { randomUUID } from "node:crypto";
import {
  toolError,
  type GitChangedFile,
  type ToolFailure,
  type Workspace,
  type WorkspaceDiffStat,
  type WorkspaceGitStatusData,
  type WorkspacePatchApplyData,
  type WorkspacePatchDiagnostic,
  type WorkspacePatchMode,
} from "../domain/index.ts";
import {
  GIT_ADAPTER_ERROR_CODES,
  GitAdapterError,
  LocalGitAdapter,
  type GitAdapter,
  type GitDiffSnapshot,
  type GitPatchTarget,
  type GitStatusSnapshot,
} from "../adapters/git/index.ts";
import { safeErrorMessage } from "../adapters/safe-metadata.ts";
import { WorkspacePathBoundaryError } from "../filesystem/workspace-paths.ts";
import { runAuditedOperation, RunnerOperationDeniedError } from "../security/audit.ts";
import {
  evaluateWorkspaceOperationPolicy,
  normalizeWorkspaceRelativePath,
  type SecurityActor,
  type WorkspaceSecurityPolicy,
} from "../security/policy.ts";
import type { RunnerSecurityServices } from "../security/services.ts";
import { LocalWorkspaceFilesystem } from "./local-workspace-filesystem.ts";
import { WORKSPACE_GIT_DEFAULT_LIMITS, WORKSPACE_GIT_HARD_LIMITS } from "./workspace-git-service.ts";
import type { WorkspaceLifecycleService } from "./workspace-lifecycle-service.ts";
import { type Clock, type WorkspaceRegistry } from "./workspace-registry.ts";

export const WORKSPACE_PATCH_DEFAULT_LIMITS = {
  maxFiles: WORKSPACE_GIT_DEFAULT_LIMITS.maxFiles,
  maxPatchBytes: 2_000_000,
} as const;

export const WORKSPACE_PATCH_HARD_LIMITS = {
  maxFiles: WORKSPACE_GIT_HARD_LIMITS.maxFiles,
  maxPatchBytes: 2_000_000,
} as const;

export const WORKSPACE_PATCH_ERROR_CODES = {
  invalidInput: "invalid_input",
  workspaceNotFound: "workspace_not_found",
  workspaceUnavailable: "workspace_unavailable",
  operationDenied: "operation_denied",
  gitUnavailable: "git_unavailable",
  notGitWorkspace: "not_git_workspace",
  patchOperationFailed: "patch_operation_failed",
} as const;

export type WorkspacePatchErrorCode =
  (typeof WORKSPACE_PATCH_ERROR_CODES)[keyof typeof WORKSPACE_PATCH_ERROR_CODES];

export class WorkspacePatchServiceError extends Error {
  readonly code: WorkspacePatchErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: WorkspacePatchErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "WorkspacePatchServiceError";
    this.code = code;
    this.details = details;
  }
}

export type WorkspacePatchServiceOptions = {
  workspaceRegistry: WorkspaceRegistry;
  workspaceFilesystem: LocalWorkspaceFilesystem;
  security: RunnerSecurityServices;
  gitAdapter?: GitAdapter;
  workspaceLifecycleService?: WorkspaceLifecycleService;
  clock?: Clock;
  createPatchId?: () => string;
};

export type ApplyWorkspacePatchRequest = {
  workspaceId: string;
  patch: string;
  expectedBaseCommit?: string;
  mode?: WorkspacePatchMode;
  actor?: SecurityActor;
};

export class WorkspacePatchService {
  readonly #workspaceRegistry: WorkspaceRegistry;
  readonly #workspaceFilesystem: LocalWorkspaceFilesystem;
  readonly #security: RunnerSecurityServices;
  readonly #gitAdapter: GitAdapter;
  readonly #workspaceLifecycleService: WorkspaceLifecycleService | null;
  readonly #clock: Clock;
  readonly #createPatchId: () => string;

  constructor({
    workspaceRegistry,
    workspaceFilesystem,
    security,
    gitAdapter = new LocalGitAdapter(),
    workspaceLifecycleService,
    clock = () => new Date(),
    createPatchId = createWorkspacePatchId,
  }: WorkspacePatchServiceOptions) {
    this.#workspaceRegistry = workspaceRegistry;
    this.#workspaceFilesystem = workspaceFilesystem;
    this.#security = security;
    this.#gitAdapter = gitAdapter;
    this.#workspaceLifecycleService = workspaceLifecycleService ?? null;
    this.#clock = clock;
    this.#createPatchId = createPatchId;
  }

  async applyPatch(input: ApplyWorkspacePatchRequest): Promise<WorkspacePatchApplyData> {
    const workspace = this.#requireReadyWorkspace(input.workspaceId);
    const policy = this.#security.createWorkspacePolicy(workspace);
    const mode = input.mode ?? "apply";
    const patchBytes = Buffer.byteLength(input.patch, "utf8");
    const maxPatchBytes = clampLimit(
      policy.patch.maxPatchBytes,
      1,
      WORKSPACE_PATCH_HARD_LIMITS.maxPatchBytes,
    );
    const maxFiles = WORKSPACE_PATCH_DEFAULT_LIMITS.maxFiles;
    const patchId = this.#createPatchId();
    const workspaceDirectory = this.#workspaceFilesystem.resolveWorkspaceDirectoryForOperation(workspace.workspaceId);
    const operation = {
      workspaceId: workspace.workspaceId,
      operationKind: "patch",
      action: "apply_patch",
      actor: input.actor ?? "assistant",
      metadata: {
        patchId,
        mode,
        patchBytes,
        expectedBaseCommitPresent: input.expectedBaseCommit !== undefined,
        requirePreflight: policy.patch.requirePreflight,
      },
    } as const;

    try {
      return await runAuditedOperation({
        recorder: this.#security.auditRecorder,
        operation,
        evaluatePolicy: () => evaluateWorkspaceOperationPolicy(policy, operation),
        execute: async () => {
          const beforeStatus = await this.#gitAdapter.getStatus(workspaceDirectory);
          const beforeDiff = await this.#gitAdapter.getDiff(workspaceDirectory, {
            includePatch: false,
            maxPatchBytes: 1,
          });

          if (patchBytes === 0 || input.patch.trim().length === 0) {
            return this.#buildResult({
              patchId,
              workspaceId: workspace.workspaceId,
              mode,
              applied: false,
              baseCommit: beforeStatus.headCommit,
              resultingCommit: beforeStatus.headCommit,
              checkedFiles: [],
              diff: beforeDiff,
              status: beforeStatus,
              maxFiles,
              maxPatchBytes,
              diagnostics: [diagnostic("empty_patch", "error", "Patch content must not be empty.")],
            });
          }

          if (patchBytes > maxPatchBytes) {
            return this.#buildResult({
              patchId,
              workspaceId: workspace.workspaceId,
              mode,
              applied: false,
              baseCommit: beforeStatus.headCommit,
              resultingCommit: beforeStatus.headCommit,
              checkedFiles: [],
              diff: beforeDiff,
              status: beforeStatus,
              maxFiles,
              maxPatchBytes,
              diagnostics: [diagnostic(
                "patch_too_large",
                "error",
                `Patch is ${patchBytes} bytes, which exceeds the ${maxPatchBytes} byte workspace patch limit.`,
              )],
            });
          }

          if (
            input.expectedBaseCommit !== undefined
            && beforeStatus.headCommit !== input.expectedBaseCommit
          ) {
            return this.#buildResult({
              patchId,
              workspaceId: workspace.workspaceId,
              mode,
              applied: false,
              baseCommit: beforeStatus.headCommit,
              resultingCommit: beforeStatus.headCommit,
              checkedFiles: [],
              diff: beforeDiff,
              status: beforeStatus,
              maxFiles,
              maxPatchBytes,
              diagnostics: [diagnostic(
                "base_commit_mismatch",
                "error",
                "Patch expectedBaseCommit does not match the current workspace HEAD commit.",
              )],
            });
          }

          const inspectedTargets = await this.#inspectPatchTargets({
            workspaceDirectory,
            patch: input.patch,
          });
          if (inspectedTargets.diagnostic !== null) {
            return this.#buildResult({
              patchId,
              workspaceId: workspace.workspaceId,
              mode,
              applied: false,
              baseCommit: beforeStatus.headCommit,
              resultingCommit: beforeStatus.headCommit,
              checkedFiles: [],
              diff: beforeDiff,
              status: beforeStatus,
              maxFiles,
              maxPatchBytes,
              diagnostics: [inspectedTargets.diagnostic],
            });
          }

          const targets = inspectedTargets.targets;
          const targetPathDiagnostics = this.#validatePatchTargets({ workspace, targets, policy });
          if (targetPathDiagnostics.length > 0) {
            return this.#buildResult({
              patchId,
              workspaceId: workspace.workspaceId,
              mode,
              applied: false,
              baseCommit: beforeStatus.headCommit,
              resultingCommit: beforeStatus.headCommit,
              checkedFiles: targets.map((target) => target.path),
              diff: beforeDiff,
              status: beforeStatus,
              maxFiles,
              maxPatchBytes,
              diagnostics: targetPathDiagnostics,
            });
          }

          const preflightDiagnostic = await this.#checkPatch({
            workspaceDirectory,
            patch: input.patch,
          });
          if (preflightDiagnostic !== null) {
            return this.#buildResult({
              patchId,
              workspaceId: workspace.workspaceId,
              mode,
              applied: false,
              baseCommit: beforeStatus.headCommit,
              resultingCommit: beforeStatus.headCommit,
              checkedFiles: targets.map((target) => target.path),
              diff: beforeDiff,
              status: beforeStatus,
              maxFiles,
              maxPatchBytes,
              diagnostics: [preflightDiagnostic],
            });
          }

          if (mode === "check") {
            return this.#buildResult({
              patchId,
              workspaceId: workspace.workspaceId,
              mode,
              applied: false,
              baseCommit: beforeStatus.headCommit,
              resultingCommit: beforeStatus.headCommit,
              checkedFiles: targets.map((target) => target.path),
              diff: beforeDiff,
              status: beforeStatus,
              maxFiles,
              maxPatchBytes,
              diagnostics: [
                diagnostic("preflight_succeeded", "info", "Patch preflight succeeded. No changes were applied in check mode."),
                diagnostic("snapshot_deferred", "info", "Patch snapshot creation is deferred to Issue #13."),
              ],
            });
          }

          const applyDiagnostic = await this.#applyPatch({
            workspaceDirectory,
            patch: input.patch,
          });
          if (applyDiagnostic !== null) {
            const currentStatus = await this.#gitAdapter.getStatus(workspaceDirectory);
            const currentDiff = await this.#gitAdapter.getDiff(workspaceDirectory, {
              includePatch: false,
              maxPatchBytes: 1,
            });
            return this.#buildResult({
              patchId,
              workspaceId: workspace.workspaceId,
              mode,
              applied: false,
              baseCommit: beforeStatus.headCommit,
              resultingCommit: currentStatus.headCommit,
              checkedFiles: targets.map((target) => target.path),
              diff: currentDiff,
              status: currentStatus,
              maxFiles,
              maxPatchBytes,
              diagnostics: [applyDiagnostic],
            });
          }

          const afterStatus = await this.#gitAdapter.getStatus(workspaceDirectory);
          const afterDiff = await this.#gitAdapter.getDiff(workspaceDirectory, {
            includePatch: false,
            maxPatchBytes: 1,
          });
          this.#workspaceLifecycleService?.markDirty(workspace.workspaceId);

          return this.#buildResult({
            patchId,
            workspaceId: workspace.workspaceId,
            mode,
            applied: true,
            baseCommit: beforeStatus.headCommit,
            resultingCommit: afterStatus.headCommit,
            checkedFiles: targets.map((target) => target.path),
            diff: afterDiff,
            status: afterStatus,
            maxFiles,
            maxPatchBytes,
            diagnostics: [
              diagnostic("patch_applied", "info", "Patch applied successfully."),
              diagnostic("snapshot_deferred", "info", "Patch snapshot creation is deferred to Issue #13."),
            ],
          });
        },
        now: this.#clock,
        logMasker: this.#security.logMasker,
      });
    } catch (error) {
      throw toWorkspacePatchServiceError(error, workspace.workspaceId);
    }
  }

  #requireReadyWorkspace(workspaceId: string): Workspace {
    const workspace = this.#workspaceRegistry.getWorkspace(workspaceId);
    if (workspace === null) {
      throw new WorkspacePatchServiceError(
        WORKSPACE_PATCH_ERROR_CODES.workspaceNotFound,
        "Workspace not found.",
        { workspaceId },
      );
    }

    if (workspace.status !== "ready") {
      throw new WorkspacePatchServiceError(
        WORKSPACE_PATCH_ERROR_CODES.workspaceUnavailable,
        "Workspace is not ready for patch operations.",
        { workspaceId, status: workspace.status },
      );
    }

    return workspace;
  }

  async #inspectPatchTargets({
    workspaceDirectory,
    patch,
  }: {
    workspaceDirectory: string;
    patch: string;
  }): Promise<{ targets: GitPatchTarget[]; diagnostic: WorkspacePatchDiagnostic | null }> {
    try {
      return {
        targets: (await this.#gitAdapter.inspectPatchTargets(workspaceDirectory, { patch })).targetFiles,
        diagnostic: null,
      };
    } catch (error) {
      return handlePatchInspectionError(error);
    }
  }

  #validatePatchTargets({
    workspace,
    targets,
    policy,
  }: {
    workspace: Workspace;
    targets: readonly GitPatchTarget[];
    policy: WorkspaceSecurityPolicy;
  }): WorkspacePatchDiagnostic[] {
    const diagnostics: WorkspacePatchDiagnostic[] = [];
    const seenPaths = new Set<string>();

    for (const target of targets) {
      if (seenPaths.has(target.path)) {
        continue;
      }
      seenPaths.add(target.path);

      const normalized = normalizeWorkspaceRelativePath(target.path);
      if (!normalized.success) {
        diagnostics.push(diagnostic("unsafe_path", "error", normalized.message, target.path));
        continue;
      }

      const pathDecision = evaluateWorkspaceOperationPolicy(policy, {
        workspaceId: workspace.workspaceId,
        operationKind: "patch",
        action: "apply_patch",
        actor: "assistant",
        relativePath: normalized.relativePath,
      });
      if (pathDecision.outcome === "denied") {
        diagnostics.push(diagnostic(
          "unsafe_path",
          "error",
          pathDecision.message ?? "Patch target path is denied by workspace policy.",
          normalized.relativePath,
        ));
        continue;
      }

      if (pathMatchesDeniedPrefix(normalized.relativePath, policy.file.deniedPathPrefixes)) {
        diagnostics.push(diagnostic(
          "unsafe_path",
          "error",
          `Patch target path '${normalized.relativePath}' is denied by workspace file policy.`,
          normalized.relativePath,
        ));
        continue;
      }

      try {
        this.#workspaceFilesystem.assertWorkspaceRelativePathInsideBoundary(
          workspace.workspaceId,
          normalized.relativePath,
        );
      } catch (error) {
        const message = error instanceof WorkspacePathBoundaryError
          ? error.message
          : "Patch target path failed workspace boundary validation.";
        diagnostics.push(diagnostic("unsafe_path", "error", message, normalized.relativePath));
      }
    }

    return diagnostics;
  }

  async #checkPatch({
    workspaceDirectory,
    patch,
  }: {
    workspaceDirectory: string;
    patch: string;
  }): Promise<WorkspacePatchDiagnostic | null> {
    try {
      await this.#gitAdapter.checkPatch(workspaceDirectory, { patch });
      return null;
    } catch (error) {
      return diagnosticFromGitError(error, "invalid_patch", "Patch preflight failed.");
    }
  }

  async #applyPatch({
    workspaceDirectory,
    patch,
  }: {
    workspaceDirectory: string;
    patch: string;
  }): Promise<WorkspacePatchDiagnostic | null> {
    try {
      await this.#gitAdapter.applyPatch(workspaceDirectory, { patch });
      return null;
    } catch (error) {
      return diagnosticFromGitError(error, "git_apply_failed", "Patch application failed after preflight.");
    }
  }

  #buildResult({
    patchId,
    workspaceId,
    mode,
    applied,
    baseCommit,
    resultingCommit,
    checkedFiles,
    diff,
    status,
    maxFiles,
    maxPatchBytes,
    diagnostics,
  }: {
    patchId: string;
    workspaceId: string;
    mode: WorkspacePatchMode;
    applied: boolean;
    baseCommit: string | null;
    resultingCommit: string | null;
    checkedFiles: readonly string[];
    diff: GitDiffSnapshot;
    status: GitStatusSnapshot;
    maxFiles: number;
    maxPatchBytes: number;
    diagnostics: readonly WorkspacePatchDiagnostic[];
  }): WorkspacePatchApplyData {
    const uniqueCheckedFiles = [...new Set(checkedFiles)].sort();
    const visibleCheckedFiles = uniqueCheckedFiles.slice(0, maxFiles);
    const visibleChangedFiles = diff.changedFiles.slice(0, maxFiles);

    return {
      patchId,
      workspaceId,
      mode,
      applied,
      baseCommit,
      resultingCommit,
      checkedFiles: visibleCheckedFiles,
      checkedFilesTruncated: visibleCheckedFiles.length < uniqueCheckedFiles.length,
      totalCheckedFiles: uniqueCheckedFiles.length,
      changedFiles: visibleChangedFiles,
      changedFilesTruncated: visibleChangedFiles.length < diff.changedFiles.length,
      totalChangedFiles: diff.changedFiles.length,
      diffstat: diff.diffstat,
      gitStatus: toGitStatusData({ workspaceId, status, maxFiles }),
      diagnostics: [...diagnostics],
      snapshotCreated: false,
      snapshotPolicy: "deferred_to_issue_13",
      limits: {
        maxPatchBytes,
        maxFiles,
      },
    };
  }
}

export function toWorkspacePatchToolFailure(error: unknown): ToolFailure {
  if (error instanceof WorkspacePatchServiceError) {
    return toolError(error.code, error.message, error.details);
  }

  return toolError(
    WORKSPACE_PATCH_ERROR_CODES.patchOperationFailed,
    "Workspace patch operation failed.",
    { message: error instanceof Error ? error.message : String(error) },
  );
}

function handlePatchInspectionError(
  error: unknown,
): { targets: GitPatchTarget[]; diagnostic: WorkspacePatchDiagnostic | null } {
  if (error instanceof GitAdapterError && error.code === GIT_ADAPTER_ERROR_CODES.gitCommandFailed) {
    return {
      targets: [],
      diagnostic: diagnosticFromGitError(error, "invalid_patch", "Patch target inspection failed."),
    };
  }

  throw error;
}

function toWorkspacePatchServiceError(error: unknown, workspaceId: string): WorkspacePatchServiceError {
  if (error instanceof WorkspacePatchServiceError) {
    return error;
  }

  if (error instanceof RunnerOperationDeniedError) {
    return new WorkspacePatchServiceError(
      WORKSPACE_PATCH_ERROR_CODES.operationDenied,
      error.decision.message ?? "Workspace patch operation denied by policy.",
      {
        workspaceId,
        reasonCode: error.decision.reasonCode,
        action: error.operation.action,
      },
    );
  }

  if (error instanceof GitAdapterError) {
    switch (error.code) {
      case GIT_ADAPTER_ERROR_CODES.gitUnavailable:
        return new WorkspacePatchServiceError(
          WORKSPACE_PATCH_ERROR_CODES.gitUnavailable,
          "Git executable is unavailable.",
          { workspaceId },
        );
      case GIT_ADAPTER_ERROR_CODES.notGitWorkspace:
        return new WorkspacePatchServiceError(
          WORKSPACE_PATCH_ERROR_CODES.notGitWorkspace,
          "Workspace directory is not a git work tree.",
          { workspaceId },
        );
      case GIT_ADAPTER_ERROR_CODES.gitCommandFailed:
        return new WorkspacePatchServiceError(
          WORKSPACE_PATCH_ERROR_CODES.patchOperationFailed,
          "Workspace patch operation failed.",
          {
            workspaceId,
            diagnostic: diagnosticFromGitError(error, "git_apply_failed", "Workspace patch operation failed."),
          },
        );
    }
  }

  return new WorkspacePatchServiceError(
    WORKSPACE_PATCH_ERROR_CODES.patchOperationFailed,
    "Workspace patch operation failed.",
    { workspaceId, message: error instanceof Error ? error.message : String(error) },
  );
}

function diagnostic(
  code: WorkspacePatchDiagnostic["code"],
  severity: WorkspacePatchDiagnostic["severity"],
  message: string,
  path?: string,
): WorkspacePatchDiagnostic {
  return {
    code,
    severity,
    message,
    ...(path === undefined ? {} : { path }),
  };
}

function diagnosticFromGitError(
  error: unknown,
  fallbackCode: WorkspacePatchDiagnostic["code"],
  fallbackMessage: string,
): WorkspacePatchDiagnostic {
  if (error instanceof GitAdapterError) {
    const details = error.toSafeDetails();
    const reasonCode = typeof details.reasonCode === "string" ? details.reasonCode : undefined;
    const stderr = typeof details.stderr === "string" ? details.stderr.trim() : "";
    const code = reasonCode === "invalid_relative_path" ? "unsafe_path" : fallbackCode;
    const message = stderr.length > 0 ? stderr : fallbackMessage;
    return diagnostic(code, "error", message);
  }

  return diagnostic(fallbackCode, "error", safeErrorMessage(error, { maxBytes: 4_096 }) || fallbackMessage);
}

function toGitStatusData({
  workspaceId,
  status,
  maxFiles,
}: {
  workspaceId: string;
  status: GitStatusSnapshot;
  maxFiles: number;
}): WorkspaceGitStatusData {
  const changedFiles = status.changedFiles.slice(0, maxFiles);
  return {
    workspaceId,
    clean: status.changedFiles.length === 0,
    branch: status.branch,
    headCommit: status.headCommit,
    changedFiles,
    truncated: changedFiles.length < status.changedFiles.length,
    totalChangedFiles: status.changedFiles.length,
    limits: { maxFiles },
  };
}

function pathMatchesDeniedPrefix(
  normalizedRelativePath: string,
  deniedPathPrefixes: readonly string[],
): boolean {
  return deniedPathPrefixes.some((rawPrefix) => {
    const normalizedPrefix = rawPrefix.replace(/\/+$/, "");
    return normalizedRelativePath === normalizedPrefix
      || normalizedRelativePath.startsWith(`${normalizedPrefix}/`);
  });
}

function clampLimit(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function createWorkspacePatchId(): string {
  return `pat_${randomUUID()}`;
}
