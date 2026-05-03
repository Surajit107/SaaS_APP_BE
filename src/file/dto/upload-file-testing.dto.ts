import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsOptional } from 'class-validator';

export class UploadFileTestingDto {
  @ApiPropertyOptional({
    description:
      'Optional workspace task id. If provided, upload is finalized immediately.',
  })
  @IsOptional()
  @IsMongoId()
  taskId?: string;
}
