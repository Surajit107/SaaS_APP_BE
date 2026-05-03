import { ApiPropertyOptional } from '@nestjs/swagger';
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
  ValidateIf,
} from 'class-validator';
import { TASK_STATUS_VALUES, type TaskStatus } from '../types/task.types';

export class UpdateTaskDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  title?: string;

  @ApiPropertyOptional({
    description: 'Set to empty string/null to clear description',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === null) return null;
    if (typeof value !== 'string') return value;
    const t = value.trim();
    return t.length > 0 ? t : null;
  })
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @ApiPropertyOptional({
    type: [String],
    description: 'Replace attachment URLs (send empty array to clear all)',
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
    description:
      'Temporary Cloudinary publicIds to finalize and append to attachments',
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

  @ApiPropertyOptional({ enum: TASK_STATUS_VALUES })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsIn(TASK_STATUS_VALUES)
  status?: TaskStatus;

  @ApiPropertyOptional({
    description: 'Set null/empty string to unassign the task',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === null || value === '') return null;
    if (typeof value !== 'string') return value;
    const t = value.trim();
    return t.length > 0 ? t : null;
  })
  @ValidateIf((_, value) => value !== null)
  @IsMongoId()
  assignedTo?: string | null;
}
