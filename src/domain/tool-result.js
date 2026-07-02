export const COMMON_ERROR_CODES = Object.freeze({
  INVALID_INPUT: "invalid_input",
  NOT_FOUND: "not_found",
  CONFLICT: "conflict",
  UNSAFE_OPERATION: "unsafe_operation",
  INTERNAL_ERROR: "internal_error",
});

export function createToolSuccess({ result, message = null, warnings = [] }) {
  if (!Array.isArray(warnings)) {
    throw new Error("warnings must be an array");
  }

  return Object.freeze({
    ok: true,
    result,
    error: null,
    message,
    warnings: Object.freeze([...warnings]),
  });
}

export function createToolError({ code, message, details = null, retryable = false }) {
  if (typeof code !== "string" || code.trim() === "") {
    throw new Error("code must be a non-empty string");
  }

  if (typeof message !== "string" || message.trim() === "") {
    throw new Error("message must be a non-empty string");
  }

  return Object.freeze({
    ok: false,
    result: null,
    error: Object.freeze({
      code,
      message,
      details,
      retryable: Boolean(retryable),
    }),
    message: null,
    warnings: Object.freeze([]),
  });
}
