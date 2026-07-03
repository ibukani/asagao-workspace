import pino, { type Logger } from "pino";
import type { LogMasker } from "../../security/log-masking.ts";
import { passthroughLogMasker } from "../../security/log-masking.ts";
import { normalizeLogText, sanitizeMetadata } from "../safe-metadata.ts";
import type { DiagnosticsLogger } from "./diagnostics-logger.ts";

export type PinoDiagnosticsLoggerOptions = {
  logger?: Logger;
  level?: string;
  logMasker?: LogMasker;
};

export class PinoDiagnosticsLogger implements DiagnosticsLogger {
  readonly #logger: Logger;
  readonly #logMasker: LogMasker;

  constructor({
    logger = pino({ level: process.env.ASAGAO_LOG_LEVEL ?? "info" }),
    logMasker = passthroughLogMasker,
  }: PinoDiagnosticsLoggerOptions = {}) {
    this.#logger = logger;
    this.#logMasker = logMasker;
  }

  debug(message: string, metadata: Record<string, unknown> = {}): void {
    this.#logger.debug(this.#sanitize(metadata), this.#message(message));
  }

  info(message: string, metadata: Record<string, unknown> = {}): void {
    this.#logger.info(this.#sanitize(metadata), this.#message(message));
  }

  warn(message: string, metadata: Record<string, unknown> = {}): void {
    this.#logger.warn(this.#sanitize(metadata), this.#message(message));
  }

  error(message: string, metadata: Record<string, unknown> = {}): void {
    this.#logger.error(this.#sanitize(metadata), this.#message(message));
  }

  #message(message: string): string {
    return normalizeLogText(message, { masker: this.#logMasker }).content;
  }

  #sanitize(metadata: Record<string, unknown>): Record<string, unknown> {
    return sanitizeMetadata(metadata, this.#logMasker) as Record<string, unknown>;
  }
}
