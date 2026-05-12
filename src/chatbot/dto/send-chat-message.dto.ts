import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class SendChatMessageDto {
  @ApiProperty({ example: 'Summarize our workspace task priorities.', maxLength: 8000 })
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  content!: string;
}
