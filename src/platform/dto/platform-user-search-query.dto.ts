import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

/** Search is mandatory: this endpoint supports lockout lookups, not browsing. */
export class PlatformUserSearchQueryDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'Email or display name fragment; at least 3 characters.',
  })
  @IsString()
  @MinLength(3)
  search: string;
}
