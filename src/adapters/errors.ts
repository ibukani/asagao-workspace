import type { LogMasker } from "../security/log-masking.ts";
import { safeErrorMessage, sanitizeMetadata } from "./safe-metadata.ts";

export const ADAPTER_ERROR_CODES = {
  processFailed: "process_failed",
  processSpawnFailed: "process_spawn_failed",
  processTimedOut: "process_timed_out",
  processCancelled: "process_cancelled",
  gitUnavailable: "git_unavailable",
  notGitWorkspace: "not_git_workspace",
  gitCommandFailed: "git_command_failed",
  traversalFailed: "workspace_traversal_failed",
  archiveFailed: "archive_failed",
  diagnosticsFailed: "diagnostics_failed",
} as const;

export type AdapterErrorCode = (typeof ADAPTER_ERROR_CODES)[keyof typeof ADAPTER_ERROR_CODES];

export type AdapterErrorOptions = {
  operation: string;
  code: AdapterErrorCode;
  message: string;
  details?: Record<string, unknown>;
  retryable?: boolean;
  userActionable?: boolean;
  cause?: unknown;
};

export class AdapterError extends Error {
  readonly code: AdapterErrorCode;
  readonly operation: string;
  readonly details: Record<string, unknown>;
  readonly retryable: boolean;
  readonly userActionable: boolean;

  constructor({
    operation,
    code,
    message,
    details = {},
    retryable = false,
    userActionable = false,
    cause,
  }: AdapterErrorOptions) {
    super(message, { cause });
    this.name = "AdapterError";
    this.operation = operation;
    this.code = code;
    this.details = details;
    this.retryable = retryable;
    this.userActionable = userActionable;
  }

  toSafeDetails(masker?: LogMasker): Record<string, unknown> {
    return {
      operation: this.operation,
      retryable: this.retryable,
      userActionable: this.userActionable,
      ...sanitizeMetadata(this.details, masker) as Record<string, unknown>,
    };
  }
}

export function toAdapterError(
  error: unknown,
  {
    operation,
    code = ADAPTER_ERROR_CODES.processFailed,
    message = "Adapter operation failed.",
    masker,
  }: {
    operation: string;
    code?: AdapterErrorCode;
    message?: string;
    masker?: LogMasker;
  },
): AdapterError {
  if (error instanceof AdapterError) {
    return error;
  }

  return new AdapterError({
    operation,
    code,
    message,
    details: { message: safeErrorMessage(error, { masker }) },
    cause: error,
  });
}
