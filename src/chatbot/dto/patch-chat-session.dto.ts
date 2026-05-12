import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class PatchChatSessionDto {
  @ApiPropertyOptional({ example: 'Billing questions', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}
