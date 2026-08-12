import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsIn, ValidateIf } from 'class-validator';
import {
  AUTH_LOGIN_SCOPES,
  TENANT_LOGIN_PORTAL_ROLES,
  type AuthLoginScope,
  type TenantLoginPortalRole,
} from './login.dto';

/**
 * Asks for a one-time code to be emailed so the user can sign in without a
 * password. Same scope/role fields as `LoginDto`, because the resulting session
 * must be pinned to the portal that asked for it.
 */
export class RequestLoginCodeDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

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
  @ValidateIf((o: RequestLoginCodeDto) => o.authScope === 'tenant')
  @IsIn(TENANT_LOGIN_PORTAL_ROLES)
  tenantRole?: TenantLoginPortalRole;
}
