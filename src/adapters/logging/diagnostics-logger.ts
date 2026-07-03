export type DiagnosticsLogLevel = "debug" | "info" | "warn" | "error";

export type DiagnosticsLogger = {
  debug: (message: string, metadata?: Record<string, unknown>) => void;
  info: (message: string, metadata?: Record<string, unknown>) => void;
  warn: (message: string, metadata?: Record<string, unknown>) => void;
  error: (message: string, metadata?: Record<string, unknown>) => void;
};

export class NoopDiagnosticsLogger implements DiagnosticsLogger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}
