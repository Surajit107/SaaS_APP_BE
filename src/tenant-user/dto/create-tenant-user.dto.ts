import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import type { TenantUserRole } from '../../user/schemas/user.schema';

export class CreateTenantUserDto {
  @ApiProperty({ example: 'jane@acme.com', description: 'Email of the user to invite' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ example: 'Jane Doe', description: 'Optional display name prefilled in the profile' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @ApiPropertyOptional({
    enum: ['admin', 'member'],
    default: 'member',
    description: "Role assigned to the user once they accept the invite. Defaults to 'member'.",
  })
  @IsOptional()
  @IsEnum(['admin', 'member'] satisfies TenantUserRole[])
  role?: TenantUserRole;
}
