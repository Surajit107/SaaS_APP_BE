import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { TASK_STATUS_VALUES, type TaskStatus } from '../types/task.types';

export class CreateTaskDto {
  @ApiProperty({ example: 'Build tenant analytics dashboard' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  title: string;

  @ApiPropertyOptional({ example: 'Include usage graph and retention cards.' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  @Transform(({ value }) => {
    if (typeof value !== 'string') return undefined;
    const t = value.trim();
    return t.length > 0 ? t : undefined;
  })
  description?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Uploaded file URLs linked with this task',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (!Array.isArray(value)) return undefined;
    const normalized = value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return Array.from(new Set(normalized));
  })
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  attachmentUrls?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Temporary Cloudinary publicIds to finalize into task attachments',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (!Array.isArray(value)) return undefined;
    const normalized = value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return Array.from(new Set(normalized));
  })
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  tempAttachmentPublicIds?: string[];

  @ApiPropertyOptional({ enum: TASK_STATUS_VALUES, default: 'TODO' })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsIn(TASK_STATUS_VALUES)
  status?: TaskStatus;

  @ApiPropertyOptional({
    description: 'User id that must belong to the same tenant as current JWT',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === null || value === undefined) return undefined;
    if (typeof value !== 'string') return value;
    const t = value.trim();
    return t.length > 0 ? t : undefined;
  })
  @IsMongoId()
  assignedTo?: string;
}
