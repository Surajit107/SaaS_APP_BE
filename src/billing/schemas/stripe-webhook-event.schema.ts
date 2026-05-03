import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type StripeWebhookEventDocument = HydratedDocument<StripeWebhookEvent>;

@Schema({ timestamps: true, collection: 'stripe_webhook_events' })
export class StripeWebhookEvent {
  @Prop({ required: true, unique: true, index: true })
  eventId: string;

  @Prop({ required: true })
  type: string;
}

export const StripeWebhookEventSchema =
  SchemaFactory.createForClass(StripeWebhookEvent);
