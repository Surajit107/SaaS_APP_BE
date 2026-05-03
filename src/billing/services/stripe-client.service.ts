import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class StripeClientService {
  private readonly stripe;

  constructor(private readonly configService: ConfigService) {
    const secretKey = configService.getOrThrow<string>('STRIPE_SECRET_KEY');
    this.stripe = new Stripe(secretKey, {
      typescript: true,
    });
  }

  getStripe() {
    return this.stripe;
  }

  getWebhookSecret(): string {
    return this.configService.getOrThrow<string>('STRIPE_WEBHOOK_SECRET');
  }
}
