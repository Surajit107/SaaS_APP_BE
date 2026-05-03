import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class RefreshTokenBodyDto {
  @ApiPropertyOptional({
    description: 'Opaque refresh token from login (jti.secret format)',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  refreshToken?: string;
}
