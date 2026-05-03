import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class CancelSubscriptionDto {
  @ApiPropertyOptional({
    description:
      'When true, cancel immediately. When false or omitted, cancel at period end.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  immediate?: boolean;
}
