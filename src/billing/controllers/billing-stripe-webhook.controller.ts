import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { StripeWebhookService } from '../services/stripe-webhook.service';

@ApiTags('Billing')
@Controller('stripe')
export class BillingStripeWebhookController {
  constructor(private readonly webhooks: StripeWebhookService) {}

  @Post('webhook')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Stripe webhook entrypoint (raw body; configure Dashboard → Webhooks → this URL)',
  })
  async handle(
    @Headers('stripe-signature') signature: string | undefined,
    @Req() req: RawBodyRequest<Request>,
  ) {
    try {
      return await this.webhooks.handleRawEvent(signature, req.rawBody);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Invalid webhook payload',
      );
    }
  }
}
