import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  PLATFORM_SUBSCRIPTION_LIST_DEFAULT_SORT_BY,
  PLATFORM_SUBSCRIPTION_LIST_DEFAULT_SORT_ORDER,
  PLATFORM_SUBSCRIPTION_LIST_SORT_BY_VALUES,
  PLATFORM_SUBSCRIPTION_LIST_SORT_ORDER_VALUES,
} from '../constants/platform-subscription-list.constants';

export class PlatformSubscriptionListQueryDto {
  @ApiPropertyOptional({
    description:
      'Exact Stripe/Mongo subscription status (e.g. active, trialing, past_due, canceled, inactive)',
    maxLength: 64,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value !== 'string') return undefined;
    const t = value.trim();
    return t.length > 0 ? t : undefined;
  })
  @IsString()
  @MaxLength(64)
  status?: string;

  @ApiPropertyOptional({
    description:
      'Restrict to this organization id (Mongo ObjectId hex; same as JWT tenantId)',
    maxLength: 24,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value !== 'string') return undefined;
    const t = value.trim();
    return t.length > 0 ? t : undefined;
  })
  @IsString()
  @MaxLength(24)
  tenantId?: string;

  @ApiPropertyOptional({
    description:
      'Substring match (case-insensitive) on tenant name or subscription tenantId',
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
    enum: PLATFORM_SUBSCRIPTION_LIST_SORT_BY_VALUES,
    default: PLATFORM_SUBSCRIPTION_LIST_DEFAULT_SORT_BY,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value !== 'string') return undefined;
    const t = value.trim();
    return t.length > 0 ? t : undefined;
  })
  @IsIn([...PLATFORM_SUBSCRIPTION_LIST_SORT_BY_VALUES])
  sortBy?: (typeof PLATFORM_SUBSCRIPTION_LIST_SORT_BY_VALUES)[number] =
    PLATFORM_SUBSCRIPTION_LIST_DEFAULT_SORT_BY;

  @ApiPropertyOptional({
    enum: PLATFORM_SUBSCRIPTION_LIST_SORT_ORDER_VALUES,
    default: PLATFORM_SUBSCRIPTION_LIST_DEFAULT_SORT_ORDER,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value !== 'string') return undefined;
    const t = value.trim().toLowerCase();
    return t.length > 0 ? t : undefined;
  })
  @IsIn([...PLATFORM_SUBSCRIPTION_LIST_SORT_ORDER_VALUES])
  sortOrder?: (typeof PLATFORM_SUBSCRIPTION_LIST_SORT_ORDER_VALUES)[number] =
    PLATFORM_SUBSCRIPTION_LIST_DEFAULT_SORT_ORDER;

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
