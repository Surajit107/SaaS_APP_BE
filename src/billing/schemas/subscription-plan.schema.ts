import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * Optional caps and flags for this SaaS product (tenant-scoped).
 * Enforcement lives in domain services; this document is the catalog source of truth.
 */
@Schema({ _id: false })
export class SubscriptionPlanFeatures {
  /** Maximum workspaces per tenant (`workspaces` collection). Omit for no catalog cap. */
  @Prop()
  maxWorkspaces?: number;

  /** Maximum org users (seats) per tenant (`users` with matching `tenantId`). */
  @Prop()
  maxUsers?: number;

  /** Maximum file metadata rows per tenant (`file_assets`). */
  @Prop()
  maxFileAssets?: number;

  /** Total storage quota in megabytes (for when `file_assets` track size). */
  @Prop()
  maxStorageMb?: number;

  /**
   * When `true`, tenant users on this plan may use the AI assistant (only valid for Pro / Enterprise catalog names;
   * enforced in `SubscriptionPlanAdminService`).
   * When `false`, AI is disabled for this plan even if the name looks like Pro/Enterprise.
   * When omitted, access follows plan name (Pro / Enterprise) — see `SubscriptionEntitlementsService`.
   */
  @Prop()
  aiChatbot?: boolean;
}

export type SubscriptionPlanDocument = HydratedDocument<SubscriptionPlan>;

@Schema({ timestamps: true, collection: 'subscription_plans' })
export class SubscriptionPlan {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, index: true })
  stripeProductId: string;

  @Prop({ required: true, index: true })
  stripePriceId: string;

  /** Display / billing amount in major currency units (e.g. USD dollars), as in the reference API. */
  @Prop({ required: true })
  amount: number;

  @Prop({ default: 'usd' })
  currency: string;

  /** Stripe recurring interval: day | week | month | year */
  @Prop({ required: true })
  interval: string;

  @Prop({ default: 0 })
  trialDays: number;

  @Prop({ default: false })
  isTrialEnabled: boolean;

  @Prop({ default: false, index: true })
  archived: boolean;

  @Prop({ type: SubscriptionPlanFeatures })
  features?: SubscriptionPlanFeatures;
}

export const SubscriptionPlanSchema =
  SchemaFactory.createForClass(SubscriptionPlan);
SubscriptionPlanSchema.index({ archived: 1, createdAt: -1 });
