import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import type { TenantUserRole } from '../../user/schemas/user.schema';

export class UpdateTenantUserDto {
  @ApiPropertyOptional({ example: 'Jane Doe' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @ApiPropertyOptional({ enum: ['admin', 'member'] })
  @IsOptional()
  @IsEnum(['admin', 'member'] satisfies TenantUserRole[])
  role?: TenantUserRole;

  @ApiPropertyOptional({
    description: 'Set false to deactivate the account (user cannot log in).',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
