import type { Workspace } from "../domain/index.ts";
import {
  InMemoryAuditEventRecorder,
  type AuditEventRecorder,
} from "./audit.ts";
import {
  passthroughLogMasker,
  type LogMasker,
} from "./log-masking.ts";
import {
  createWorkspaceSecurityPolicy,
  type WorkspaceSecurityPolicy,
} from "./policy.ts";

export type WorkspaceSecurityPolicyFactory = (
  workspace: Pick<Workspace, "workspaceId" | "internetPolicy">,
) => WorkspaceSecurityPolicy;

export type RunnerSecurityServices = {
  auditRecorder: AuditEventRecorder;
  logMasker: LogMasker;
  createWorkspacePolicy: WorkspaceSecurityPolicyFactory;
};

export type CreateRunnerSecurityServicesOptions = {
  auditRecorder?: AuditEventRecorder;
  logMasker?: LogMasker;
  createWorkspacePolicy?: WorkspaceSecurityPolicyFactory;
};

export function createRunnerSecurityServices(
  options: CreateRunnerSecurityServicesOptions = {},
): RunnerSecurityServices {
  return Object.freeze({
    auditRecorder: options.auditRecorder ?? new InMemoryAuditEventRecorder(),
    logMasker: options.logMasker ?? passthroughLogMasker,
    createWorkspacePolicy: options.createWorkspacePolicy ?? createWorkspaceSecurityPolicy,
  });
}
