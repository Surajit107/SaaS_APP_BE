export type JwtTokenType = 'access';

export interface JwtAccessPayload {
  type: JwtTokenType;
  sub: string;
  email: string;
  tenantId: string;
  /** Issue-time flag; omit in legacy tokens → treated as false. */
  platformAdmin?: boolean;
  /**
   * Tenant-scoped role baked into the token at issue time.
   * Absent for platform admins. Legacy tokens without this field default to 'admin'
   * inside JwtAuthGuard so existing tenant owners retain access after the schema migration.
   */
  tenantRole?: 'admin' | 'member';
  iat?: number;
  exp?: number;
}
