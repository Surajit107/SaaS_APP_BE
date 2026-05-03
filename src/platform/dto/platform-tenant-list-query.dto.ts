import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class PlatformTenantListQueryDto {
  @ApiPropertyOptional({
    description:
      'Include soft-deleted tenants (shown with deletedAt/purgeAt until TTL removes them)',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  includeDeleted?: boolean = false;

  @ApiPropertyOptional({
    description:
      'Substring match (case-insensitive) on tenant name or tenant id',
    maxLength: 200,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value !== 'string') return undefined;
    const t = value.trim();
    return t.length > 0 ? t : undefined;
  })
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({
    description: 'When set, only tenants with this active flag are returned',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    const v = String(value).toLowerCase();
    if (v === 'true' || v === '1') return true;
    if (v === 'false' || v === '0') return false;
    return value;
  })
  @IsBoolean()
  isActive?: boolean;

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
