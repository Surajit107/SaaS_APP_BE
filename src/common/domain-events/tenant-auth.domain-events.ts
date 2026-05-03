/** In-process domain events: tenant user lifecycle (registration). */
export const TenantAuthEventName = {
  UserRegistered: 'tenant.auth.user_registered',
} as const;

export type TenantUserRegisteredPayload = {
  tenantId: string;
  userId: string;
  email: string;
  organizationName: string;
  displayName?: string;
  /** Raw token for the verification email only — never stored. */
  rawEmailVerificationToken: string;
};
