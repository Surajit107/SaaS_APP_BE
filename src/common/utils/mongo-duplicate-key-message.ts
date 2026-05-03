import { MongoServerError } from 'mongodb';

/**
 * Maps E11000 duplicate key errors to messages safe to show in the client UI
 * (no stack traces or raw index names).
 */
export function mapDuplicateKeyMessageToClient(err: MongoServerError): string {
  const keyValue: unknown = err.keyValue;
  if (keyValue === null || keyValue === undefined) {
    return 'This information is already in use. Try signing in, or register with different details.';
  }
  if (typeof keyValue !== 'object' || Array.isArray(keyValue)) {
    return 'This information is already in use. Try signing in, or register with different details.';
  }

  const record = keyValue as Record<string, unknown>;
  const keys = Object.keys(record);
  for (const key of keys) {
    const v = record[key];
    if (v === null || v === undefined) {
      return 'We could not complete registration for this combination. Try signing in, or use a different email or organization name.';
    }
  }

  if (keys.includes('email')) {
    return 'An account with this email already exists. Try signing in, or use a different email to register.';
  }

  if (keys.length === 1) {
    const field = keys[0];
    if (field === 'tenantId') {
      return 'This organization is already registered. Try signing in instead.';
    }
  }

  return 'This information is already in use. Try signing in, or use different values.';
}

function isDuplicateCode(value: unknown): value is MongoServerError {
  return value instanceof MongoServerError && value.code === 11000;
}

/**
 * Resolves Mongo E11000 whether thrown directly or nested (e.g. Mongoose save error `cause`).
 */
export function getMongoDuplicateKeyError(
  err: unknown,
): MongoServerError | null {
  if (isDuplicateCode(err)) {
    return err;
  }
  if (err instanceof Error && 'cause' in err) {
    const c = (err as Error & { cause?: unknown }).cause;
    if (isDuplicateCode(c)) {
      return c;
    }
  }
  return null;
}
