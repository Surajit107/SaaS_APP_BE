import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Self-serve: server creates a tenant and the **organization owner** user (always `admin`).
 * Invited members are created via tenant flows, not this endpoint.
 */
export class RegisterDto {
  @ApiProperty({ example: 'Acme Inc' })
  @IsString()
  @MinLength(1)
  organizationName: string;

  @ApiProperty({ example: 'Ada Lovelace' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName: string;

  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password-here-8chars', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;
}
