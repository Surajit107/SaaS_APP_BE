import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, ValidateNested } from 'class-validator';
import {
  CreateSubscriptionPlanDto,
  SubscriptionPlanFeaturesDto,
} from './create-subscription-plan.dto';

export class UpdateSubscriptionPlanDto extends PartialType(
  CreateSubscriptionPlanDto,
) {
  @ApiPropertyOptional({
    description:
      'Ignored — use DELETE /platform/subscription-plans/:planId to archive.',
  })
  @IsOptional()
  @IsBoolean()
  archived?: boolean;

  @ApiPropertyOptional({ type: SubscriptionPlanFeaturesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SubscriptionPlanFeaturesDto)
  override features?: SubscriptionPlanFeaturesDto;
}
