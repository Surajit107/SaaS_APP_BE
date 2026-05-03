import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

/** Body for POST /auth/verify-email (same token shape as invite links). */
export class VerifyEmailDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: 'Opaque token from the verification email (hex string).',
    minLength: 64,
  })
  @IsString()
  @MinLength(64)
  token: string;
}
