const ONE_MINUTE_MS = 60_000;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;

/**
 * Per-IP budgets for authentication endpoints, applied with `@Throttle(...)`.
 *
 * These are the outer perimeter only. Guessing a 6-digit code must also be
 * capped per challenge server-side, so an attacker cannot buy more attempts by
 * rotating IP addresses.
 */
export const AuthThrottle = {
  /** Password sign-in. */
  login: { default: { limit: 10, ttl: ONE_MINUTE_MS } },

  /** Organization sign-up. */
  register: { default: { limit: 10, ttl: ONE_HOUR_MS } },

  /** Redeeming an emailed verification link. */
  verifyEmail: { default: { limit: 20, ttl: ONE_MINUTE_MS } },

  /** Asking for a one-time code to be emailed. */
  requestLoginCode: { default: { limit: 3, ttl: 10 * ONE_MINUTE_MS } },

  /** Submitting a 6-digit code (authenticator, backup, or emailed). */
  verifyCode: { default: { limit: 10, ttl: ONE_MINUTE_MS } },

  /** Enrollment and preference changes behind an authenticated session. */
  manageMfa: { default: { limit: 20, ttl: ONE_MINUTE_MS } },
} as const;
