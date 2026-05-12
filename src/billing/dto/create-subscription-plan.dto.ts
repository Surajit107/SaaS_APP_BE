import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const BILLING_INTERVALS = ['day', 'week', 'month', 'year'] as const;

export class SubscriptionPlanFeaturesDto {
  @ApiPropertyOptional({ example: 5, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxWorkspaces?: number;

  @ApiPropertyOptional({ example: 25, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxUsers?: number;

  @ApiPropertyOptional({ example: 1000, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxFileAssets?: number;

  @ApiPropertyOptional({
    example: 10240,
    minimum: 0,
    description: 'Total quota in MB',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxStorageMb?: number;

  @ApiPropertyOptional({
    description:
      'Override AI assistant access for this plan (only allowed when the plan name is Pro or Enterprise tier). Omit to derive from plan name.',
  })
  @IsOptional()
  @IsBoolean()
  aiChatbot?: boolean;
}

export class CreateSubscriptionPlanDto {
  @ApiProperty({ example: 'Pro', maxLength: 256 })
  @IsString()
  @MaxLength(256)
  name!: string;

  @ApiProperty({
    example: 29,
    minimum: 0,
    description:
      'Amount in major currency units (e.g. USD dollars before Stripe minor units)',
  })
  @IsNumber()
  @Min(0)
  amount!: number;

  @ApiProperty({ enum: BILLING_INTERVALS, example: 'month' })
  @IsString()
  @IsIn([...BILLING_INTERVALS])
  interval!: (typeof BILLING_INTERVALS)[number];

  @ApiPropertyOptional({ example: 'usd', maxLength: 8 })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @ApiPropertyOptional({ example: 14, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  trialDays?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isTrialEnabled?: boolean;

  @ApiPropertyOptional({ type: SubscriptionPlanFeaturesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SubscriptionPlanFeaturesDto)
  features?: SubscriptionPlanFeaturesDto;
}
