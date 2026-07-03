import { stripVTControlCharacters } from "node:util";
import type { LogMasker } from "../security/log-masking.ts";

export const DEFAULT_SAFE_TEXT_MAX_BYTES = 16_384;

export type TruncatedText = {
  content: string;
  truncated: boolean;
  returnedBytes: number;
  originalBytes: number;
  maxBytes: number;
};

export function truncateUtf8(value: string, maxBytes: number): TruncatedText {
  const originalBytes = Buffer.byteLength(value, "utf8");
  const boundedMaxBytes = Math.max(0, maxBytes);

  if (originalBytes <= boundedMaxBytes) {
    return {
      content: value,
      truncated: false,
      returnedBytes: originalBytes,
      originalBytes,
      maxBytes: boundedMaxBytes,
    };
  }

  let bytes = 0;
  let endIndex = 0;
  for (const character of value) {
    const nextBytes = Buffer.byteLength(character, "utf8");
    if (bytes + nextBytes > boundedMaxBytes) {
      break;
    }

    bytes += nextBytes;
    endIndex += character.length;
  }

  return {
    content: value.slice(0, endIndex),
    truncated: true,
    returnedBytes: bytes,
    originalBytes,
    maxBytes: boundedMaxBytes,
  };
}

export function normalizeLogText(
  value: string,
  {
    maxBytes = DEFAULT_SAFE_TEXT_MAX_BYTES,
    masker,
  }: {
    maxBytes?: number;
    masker?: LogMasker;
  } = {},
): TruncatedText {
  const masked = masker === undefined ? value : masker.maskText(value);
  return truncateUtf8(stripVTControlCharacters(masked), maxBytes);
}

export function safeErrorMessage(
  error: unknown,
  {
    masker,
    maxBytes = DEFAULT_SAFE_TEXT_MAX_BYTES,
  }: {
    masker?: LogMasker;
    maxBytes?: number;
  } = {},
): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  return normalizeLogText(rawMessage, { masker, maxBytes }).content;
}

export function safeCommand(command: readonly string[]): string[] {
  return command.map((part) => normalizeLogText(part, { maxBytes: 2_048 }).content);
}

export function hasRedactableName(name: string): boolean {
  return /token|secret|password|passwd|credential|api[_-]?key|authorization/i.test(name);
}

export function sanitizeMetadata(value: unknown, masker?: LogMasker): unknown {
  if (typeof value === "string") {
    return normalizeLogText(value, { masker }).content;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeMetadata(entry, masker));
  }

  if (typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      hasRedactableName(key) ? "[REDACTED]" : sanitizeMetadata(entry, masker),
    ]));
  }

  return value;
}
