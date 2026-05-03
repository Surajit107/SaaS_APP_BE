import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SubscriptionDocument = HydratedDocument<Subscription>;

@Schema({ timestamps: true, collection: 'subscriptions' })
export class Subscription {
  @Prop({ required: true, unique: true, index: true })
  tenantId: string;

  /**
   * Human-readable plan key (name slug or Mongo id of plan); kept for compatibility with earlier schema.
   */
  @Prop({ default: '' })
  planKey: string;

  @Prop({ default: 'inactive' })
  status: string;

  @Prop({ index: true, sparse: true })
  stripeCustomerId?: string;

  @Prop({ index: true, sparse: true })
  stripeSubscriptionId?: string;

  @Prop()
  stripePriceId?: string;

  @Prop()
  currentPeriodStart?: Date;

  @Prop()
  currentPeriodEnd?: Date;

  @Prop({ default: false })
  cancelAtPeriodEnd?: boolean;

  createdAt?: Date;
  updatedAt?: Date;
}

export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);
SubscriptionSchema.index({ tenantId: 1, createdAt: -1 });
SubscriptionSchema.index({ status: 1, updatedAt: -1 });
