import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateChatSessionDto {
  @ApiPropertyOptional({ example: 'Q4 planning', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}
