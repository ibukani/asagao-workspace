import { execa } from "execa";
import {
  ADAPTER_ERROR_CODES,
  AdapterError,
} from "../errors.ts";
import { truncateUtf8 } from "../safe-metadata.ts";
import {
  PROCESS_RUNNER_DEFAULT_LIMITS,
  type ProcessFailureKind,
  type ProcessRunner,
  type ProcessRunnerRequest,
  type ProcessRunnerResult,
} from "./process-runner.ts";

export class ExecaProcessRunner implements ProcessRunner {
  async run(request: ProcessRunnerRequest): Promise<ProcessRunnerResult> {
    const command = [request.executable, ...request.args] as const;
    const maxStdoutBytes = request.maxStdoutBytes ?? PROCESS_RUNNER_DEFAULT_LIMITS.maxStdoutBytes;
    const maxStderrBytes = request.maxStderrBytes ?? PROCESS_RUNNER_DEFAULT_LIMITS.maxStderrBytes;
    const timeoutMs = request.timeoutMs ?? PROCESS_RUNNER_DEFAULT_LIMITS.timeoutMs;

    try {
      const result = await execa(request.executable, [...request.args], {
        cwd: request.cwd,
        shell: false,
        stdin: request.stdin === undefined ? "ignore" : "pipe",
        input: request.stdin,
        stdout: "pipe",
        stderr: "pipe",
        reject: false,
        timeout: timeoutMs,
        cancelSignal: request.cancelSignal,
        stripFinalNewline: false,
        encoding: "utf8",
        maxBuffer: Math.max(maxStdoutBytes, maxStderrBytes) + 1,
      });

      return normalizeProcessResult({
        command,
        cwd: request.cwd ?? null,
        failed: result.failed,
        exitCode: result.exitCode ?? null,
        signal: result.signal ?? null,
        timedOut: result.timedOut,
        cancelled: result.isCanceled,
        isMaxBuffer: result.isMaxBuffer,
        stdout: typeof result.stdout === "string" ? result.stdout : String(result.stdout ?? ""),
        stderr: typeof result.stderr === "string" ? result.stderr : String(result.stderr ?? ""),
        maxStdoutBytes,
        maxStderrBytes,
      });
    } catch (error) {
      return normalizeCaughtError({
        error,
        command,
        cwd: request.cwd ?? null,
        maxStdoutBytes,
        maxStderrBytes,
      });
    }
  }
}

function normalizeProcessResult({
  command,
  cwd,
  failed,
  exitCode,
  signal,
  timedOut,
  cancelled,
  isMaxBuffer,
  stdout,
  stderr,
  maxStdoutBytes,
  maxStderrBytes,
}: {
  command: readonly string[];
  cwd: string | null;
  failed: boolean;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  cancelled: boolean;
  isMaxBuffer: boolean;
  stdout: string;
  stderr: string;
  maxStdoutBytes: number;
  maxStderrBytes: number;
}): ProcessRunnerResult {
  const boundedStdout = truncateUtf8(stdout, maxStdoutBytes);
  const boundedStderr = truncateUtf8(stderr, maxStderrBytes);

  return {
    command,
    cwd,
    failed,
    failureKind: inferFailureKind({ failed, exitCode, signal, timedOut, cancelled, isMaxBuffer }),
    exitCode,
    signal,
    timedOut,
    cancelled,
    stdout: boundedStdout.content,
    stderr: boundedStderr.content,
    stdoutBytes: boundedStdout.returnedBytes,
    stderrBytes: boundedStderr.returnedBytes,
    stdoutTruncated: boundedStdout.truncated || isMaxBuffer,
    stderrTruncated: boundedStderr.truncated,
  };
}

function normalizeCaughtError({
  error,
  command,
  cwd,
  maxStdoutBytes,
  maxStderrBytes,
}: {
  error: unknown;
  command: readonly string[];
  cwd: string | null;
  maxStdoutBytes: number;
  maxStderrBytes: number;
}): ProcessRunnerResult {
  const record = isRecord(error) ? error : {};
  const stdout = typeof record.stdout === "string" ? record.stdout : "";
  const stderr = typeof record.stderr === "string" ? record.stderr : "";
  const exitCode = typeof record.exitCode === "number" ? record.exitCode : null;
  const signal = typeof record.signal === "string" ? record.signal : null;
  const timedOut = record.timedOut === true;
  const cancelled = record.isCanceled === true;
  const isMaxBuffer = record.isMaxBuffer === true;
  const spawnFailed = exitCode === null && signal === null && !timedOut && !cancelled && !isMaxBuffer;

  const normalized = normalizeProcessResult({
    command,
    cwd,
    failed: true,
    exitCode,
    signal,
    timedOut,
    cancelled,
    isMaxBuffer,
    stdout,
    stderr,
    maxStdoutBytes,
    maxStderrBytes,
  });

  return {
    ...normalized,
    failureKind: spawnFailed ? "spawn" : normalized.failureKind,
    stderr: normalized.stderr.length > 0 ? normalized.stderr : errorMessage(error),
  };
}

function inferFailureKind({
  failed,
  exitCode,
  signal,
  timedOut,
  cancelled,
  isMaxBuffer,
}: {
  failed: boolean;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  cancelled: boolean;
  isMaxBuffer: boolean;
}): ProcessFailureKind | null {
  if (!failed) {
    return null;
  }

  if (cancelled) {
    return "cancel";
  }

  if (timedOut) {
    return "timeout";
  }

  if (isMaxBuffer) {
    return "max_buffer";
  }

  if (exitCode === null && signal === null) {
    return "spawn";
  }

  return "exit";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function processResultToAdapterError(
  result: ProcessRunnerResult,
  operation: string,
): AdapterError {
  const code = result.failureKind === "spawn"
    ? ADAPTER_ERROR_CODES.processSpawnFailed
    : result.failureKind === "timeout"
      ? ADAPTER_ERROR_CODES.processTimedOut
      : result.failureKind === "cancel"
        ? ADAPTER_ERROR_CODES.processCancelled
        : ADAPTER_ERROR_CODES.processFailed;

  return new AdapterError({
    operation,
    code,
    message: "Process execution failed.",
    details: {
      command: result.command,
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      cancelled: result.cancelled,
      stderr: result.stderr,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated,
    },
  });
}
