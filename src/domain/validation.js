export function requireNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${fieldName} must be a non-empty string`);
  }

  return value;
}

export function optionalString(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string when provided`);
  }

  return value;
}

export function optionalObject(value, fieldName) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object when provided`);
  }

  return Object.freeze({ ...value });
}

export function requireAllowedValue(value, allowedValues, fieldName) {
  if (!allowedValues.includes(value)) {
    throw new Error(`${fieldName} must be one of: ${allowedValues.join(", ")}`);
  }

  return value;
}

export function optionalAllowedValue(value, allowedValues, fieldName, defaultValue) {
  return requireAllowedValue(value ?? defaultValue, allowedValues, fieldName);
}

export function toIsoTimestamp(value, fieldName) {
  const rawValue = value ?? new Date();
  const date = rawValue instanceof Date ? rawValue : new Date(rawValue);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} must be a valid timestamp`);
  }

  return date.toISOString();
}

export function optionalIsoTimestamp(value, fieldName) {
  if (value === undefined || value === null) {
    return null;
  }

  return toIsoTimestamp(value, fieldName);
}

export function optionalPositiveInteger(value, fieldName) {
  if (value === undefined || value === null) {
    return null;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive integer when provided`);
  }

  return value;
}

export function optionalNonNegativeInteger(value, fieldName, defaultValue = null) {
  const rawValue = value ?? defaultValue;
  if (rawValue === null) {
    return null;
  }

  if (!Number.isInteger(rawValue) || rawValue < 0) {
    throw new Error(`${fieldName} must be a non-negative integer when provided`);
  }

  return rawValue;
}

export function freezeArray(value, fieldName, defaultValue = []) {
  const rawValue = value ?? defaultValue;
  if (!Array.isArray(rawValue)) {
    throw new Error(`${fieldName} must be an array`);
  }

  return Object.freeze([...rawValue]);
}
