import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class AcceptInviteDto {
  @ApiProperty({ example: 'jane@acme.com', description: 'The email address the invite was sent to' })
  @IsEmail()
  email: string;

  @ApiProperty({ description: 'Raw invite token received in the invitation email link' })
  @IsString()
  @MinLength(1)
  token: string;

  @ApiProperty({ example: 'S3cur3P@ssw0rd!', description: 'Password to set for the new account (minimum 8 characters)' })
  @IsString()
  @MinLength(8)
  password: string;
}
