import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const PLATFORM_ANALYTICS_MIN_RANGE_DAYS = 1;
export const PLATFORM_ANALYTICS_MAX_RANGE_DAYS = 180;
export const PLATFORM_ANALYTICS_DEFAULT_RANGE_DAYS = 30;

export class PlatformAnalyticsQueryDto {
  @ApiPropertyOptional({
    description:
      'Window size in days for the time-series buckets (tenant growth, new MRR). Clamped to 1..180. Snapshot counters (totals, status mix, plan distribution) are always live and unaffected by this value.',
    minimum: PLATFORM_ANALYTICS_MIN_RANGE_DAYS,
    maximum: PLATFORM_ANALYTICS_MAX_RANGE_DAYS,
    default: PLATFORM_ANALYTICS_DEFAULT_RANGE_DAYS,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(PLATFORM_ANALYTICS_MIN_RANGE_DAYS)
  @Max(PLATFORM_ANALYTICS_MAX_RANGE_DAYS)
  days?: number = PLATFORM_ANALYTICS_DEFAULT_RANGE_DAYS;
}
