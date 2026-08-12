import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Accepts a 6-digit authenticator code or a formatted recovery code, so a user
 * without their phone can use the same field.
 */
export class VerifyMfaDto {
  @ApiProperty({
    description: 'Challenge token returned by POST /auth/login',
    example: '9f1c1e0a-...uuid....aGVsbG8',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  challengeToken: string;

  @ApiProperty({
    description: '6-digit authenticator code, or a recovery code',
    example: '123456',
  })
  @IsString()
  @MinLength(6)
  @MaxLength(32)
  code: string;
}

export class EnableTotpDto {
  @ApiProperty({
    description: '6-digit code from the authenticator app',
    example: '123456',
  })
  @IsString()
  @Matches(/^\s*\d{6}\s*$/, {
    message: 'Enter the 6-digit code from your authenticator app',
  })
  code: string;
}

export class DisableTotpDto {
  @ApiProperty({ description: 'Current account password' })
  @IsString()
  @MinLength(1)
  password: string;

  @ApiProperty({
    description: 'Current authenticator code, or a recovery code',
    example: '123456',
  })
  @IsString()
  @MinLength(6)
  @MaxLength(32)
  code: string;
}

export class RegenerateBackupCodesDto {
  @ApiProperty({ description: 'Current account password' })
  @IsString()
  @MinLength(1)
  password: string;
}

export class UpdateMfaPreferencesDto {
  @ApiPropertyOptional({
    description:
      'Allow signing in with a code emailed to this address. Turn off to require the authenticator app.',
  })
  @IsBoolean()
  isEmailCodeLoginEnabled: boolean;
}
