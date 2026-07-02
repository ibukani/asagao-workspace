export type LogMasker = {
  maskText: (input: string) => string;
};

export type LiteralSecretForMasking = {
  name?: string;
  value: string;
};

export const passthroughLogMasker: LogMasker = Object.freeze({
  maskText: (input: string) => input,
});

export function composeLogMaskers(maskers: readonly LogMasker[]): LogMasker {
  if (maskers.length === 0) {
    return passthroughLogMasker;
  }

  return {
    maskText(input: string): string {
      return maskers.reduce((current, masker) => masker.maskText(current), input);
    },
  };
}

export function createLiteralSecretMasker(
  secrets: readonly LiteralSecretForMasking[],
): LogMasker {
  const redactableSecrets = secrets.filter((secret) => secret.value.length > 0);

  if (redactableSecrets.length === 0) {
    return passthroughLogMasker;
  }

  return {
    maskText(input: string): string {
      return redactableSecrets.reduce((current, secret) => {
        const replacement = secret.name === undefined
          ? "[REDACTED_SECRET]"
          : `[REDACTED_SECRET:${secret.name}]`;
        return current.split(secret.value).join(replacement);
      }, input);
    },
  };
}

export function maskStructuredValue(value: unknown, masker: LogMasker): unknown {
  if (typeof value === "string") {
    return masker.maskText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => maskStructuredValue(item, masker));
  }

  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, maskStructuredValue(entry, masker)]),
    );
  }

  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}
