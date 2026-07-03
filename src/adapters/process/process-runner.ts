export const PROCESS_RUNNER_DEFAULT_LIMITS = {
  timeoutMs: 15_000,
  maxStdoutBytes: 5_000_000,
  maxStderrBytes: 16_384,
} as const;

export type ProcessFailureKind =
  | "exit"
  | "spawn"
  | "timeout"
  | "cancel"
  | "max_buffer";

export type ProcessRunnerRequest = {
  executable: string;
  args: readonly string[];
  cwd?: string;
  timeoutMs?: number;
  cancelSignal?: AbortSignal;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  stdin?: string;
};

export type ProcessRunnerResult = {
  command: readonly string[];
  cwd: string | null;
  failed: boolean;
  failureKind: ProcessFailureKind | null;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  cancelled: boolean;
  stdout: string;
  stderr: string;
  stdoutBytes: number;
  stderrBytes: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
};

export type ProcessRunner = {
  run: (request: ProcessRunnerRequest) => Promise<ProcessRunnerResult>;
};
