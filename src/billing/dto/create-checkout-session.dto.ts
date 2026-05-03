import { IsString } from 'class-validator';

export class CreateCheckoutSessionDto {
  /** Stored `SubscriptionPlan.stripePriceId`. */
  @IsString()
  stripePriceId!: string;
}
