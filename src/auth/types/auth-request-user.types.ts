/**
 * Set on `request.user` by JwtAuthGuard after Bearer access-token validation.
 */
export interface AuthenticatedRequestUser {
  userId: string;
  email: string;
  tenantId: string;
  /** True when JWT was issued from a platform operator user record (`isPlatformAdmin`). */
  platformAdmin: boolean;
  /**
   * Tenant-scoped role from the JWT. Undefined for platform admins.
   * Legacy tokens (issued before role was added) default to 'admin' in JwtAuthGuard
   * so existing tenant owners are not locked out.
   */
  tenantRole: 'admin' | 'member' | undefined;
}
