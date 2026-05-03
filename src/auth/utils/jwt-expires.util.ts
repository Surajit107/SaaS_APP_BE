import type { SignOptions } from 'jsonwebtoken';

/**
 * Aligns env string (e.g. `15m`) with `jsonwebtoken` sign `expiresIn` typing.
 */
export function parseJwtExpiresIn(
  raw: string | undefined,
  defaultValue: string,
): NonNullable<SignOptions['expiresIn']> {
  return (raw ?? defaultValue) as NonNullable<SignOptions['expiresIn']>;
}
