import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsIn, IsString, MinLength, ValidateIf } from 'class-validator';

export const AUTH_LOGIN_SCOPES = ['tenant', 'platform'] as const;
export type AuthLoginScope = (typeof AUTH_LOGIN_SCOPES)[number];

export const TENANT_LOGIN_PORTAL_ROLES = ['admin', 'member'] as const;
export type TenantLoginPortalRole = (typeof TENANT_LOGIN_PORTAL_ROLES)[number];

/**
 * Tenant is resolved from the user record after email + password; do not pass tenantId.
 * `authScope` ties this credential exchange to the correct portal (tenant vs platform operator).
 * When `authScope` is `tenant`, `tenantRole` must match the user’s stored org role so admin and
 * member sign-in pages cannot be used interchangeably.
 */
export class LoginDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  password: string;

  @ApiProperty({
    enum: AUTH_LOGIN_SCOPES,
    example: 'tenant',
    description:
      'tenant — organization users (admin or member). platform — operators only.',
  })
  @IsEnum(AUTH_LOGIN_SCOPES)
  authScope: AuthLoginScope;

  @ApiPropertyOptional({
    enum: TENANT_LOGIN_PORTAL_ROLES,
    example: 'admin',
    description:
      'Required when authScope is tenant. Must match the user’s role (admin vs member portal).',
  })
  @ValidateIf((o: LoginDto) => o.authScope === 'tenant')
  @IsIn(TENANT_LOGIN_PORTAL_ROLES)
  tenantRole?: TenantLoginPortalRole;
}
