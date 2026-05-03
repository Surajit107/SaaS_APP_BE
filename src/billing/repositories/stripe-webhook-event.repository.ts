import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { isMongooseConnectionReady } from '../../common/mongoose/connection.util';
import { StripeWebhookEvent } from '../schemas/stripe-webhook-event.schema';

@Injectable()
export class StripeWebhookEventRepository {
  constructor(
    @InjectModel(StripeWebhookEvent.name)
    private readonly model: Model<StripeWebhookEvent>,
  ) {}

  isMongooseReady(): boolean {
    return isMongooseConnectionReady(this.model.db);
  }

  /**
   * Inserts the Stripe event id if missing. Returns true when this invocation owns processing.
   */
  async claimEvent(eventId: string, type: string): Promise<boolean> {
    try {
      await this.model.create({ eventId, type });
      return true;
    } catch {
      return false;
    }
  }
}
