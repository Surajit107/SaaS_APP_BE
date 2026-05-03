import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { TASK_STATUS_VALUES, type TaskStatus } from '../types/task.types';

export class ListTasksQueryDto {
  @ApiPropertyOptional({ enum: TASK_STATUS_VALUES })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsIn(TASK_STATUS_VALUES)
  status?: TaskStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsMongoId()
  assignedTo?: string;

  @ApiPropertyOptional({
    description: 'Text search across task title/description',
    maxLength: 120,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value !== 'string') return undefined;
    const q = value.trim();
    return q.length > 0 ? q : undefined;
  })
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
