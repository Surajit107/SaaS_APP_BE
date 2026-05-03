import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  BillingSubscriptionEventName,
  type BillingInvoiceNotificationPayload,
  type BillingSubscriptionCheckoutCompletedPayload,
  type BillingSubscriptionEndedPayload,
  type BillingSubscriptionUpdatedPayload,
} from '../../common/domain-events/billing-subscription.domain-events';
import { SubscriptionPlanRepository } from '../repositories/subscription-plan.repository';
import { SubscriptionRepository } from '../repositories/subscription.repository';
import { StripeWebhookEventRepository } from '../repositories/stripe-webhook-event.repository';
import { StripeClientService } from './stripe-client.service';

/** Webhook payload shapes we read (avoids deep `stripe/cjs/...` imports). */
type StripeWebhookEventLike = {
  id: string;
  type: string;
  data: { object: unknown };
};

type CheckoutSessionPayload = {
  mode?: string | null;
  metadata?: Record<string, string> | null;
  client_reference_id?: string | null;
  subscription?: string | { id?: string } | null;
};

type SubscriptionPayload = {
  id: string;
  customer: string;
  status: string;
  current_period_start?: number | null;
  current_period_end?: number | null;
  cancel_at_period_end: boolean;
  items: { data: Array<{ price?: { id?: string } | null }> };
};

type InvoicePayload = {
  id: string;
  customer?: string | { id?: string } | null;
};

type CustomerPayload = {
  deleted?: boolean;
  metadata?: Record<string, string> | null;
};

function invoiceCustomerId(invoice: InvoicePayload): string | null {
  const c = invoice.customer;
  if (typeof c === 'string') {
    return c;
  }
  if (c && typeof c === 'object' && typeof c.id === 'string') {
    return c.id;
  }
  return null;
}

function stripeUnixToDate(value: number | null | undefined): Date | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function toIsoOrNull(value: Date | undefined): string | null {
  if (!value) {
    return null;
  }
  const time = value.getTime();
  if (Number.isNaN(time)) {
    return null;
  }
  return value.toISOString();
}

@Injectable()
export class StripeWebhookService {
  private readonly log = new Logger(StripeWebhookService.name);

  constructor(
    private readonly stripeClient: StripeClientService,
    private readonly events: StripeWebhookEventRepository,
    private readonly subscriptions: SubscriptionRepository,
    private readonly plans: SubscriptionPlanRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async handleRawEvent(
    signature: string | undefined,
    rawBody: Buffer | undefined,
  ): Promise<{ received: true }> {
    if (!signature) {
      throw new Error('Missing stripe-signature header');
    }
    if (!rawBody || rawBody.length === 0) {
      throw new Error('Missing raw webhook body');
    }

    const stripe = this.stripeClient.getStripe();
    const webhookSecret = this.stripeClient.getWebhookSecret();
    const event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      webhookSecret,
    );

    const owns = await this.events.claimEvent(event.id, event.type);
    if (!owns) {
      this.log.debug(`Duplicate webhook ignored: ${event.id}`);
      return { received: true };
    }

    try {
      await this.dispatch(event);
    } catch (err) {
      this.log.error(
        err instanceof Error ? err.message : 'Webhook handler failed',
        err instanceof Error ? err.stack : undefined,
      );
    }

    return { received: true };
  }

  private async dispatch(event: StripeWebhookEventLike): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as CheckoutSessionPayload;
        await this.onCheckoutSessionCompleted(session);
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object as SubscriptionPayload;
        await this.onSubscriptionUpdated(sub);
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as SubscriptionPayload;
        await this.onSubscriptionDeleted(sub);
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as InvoicePayload;
        await this.onInvoicePaymentFailed(invoice);
        break;
      }
      case 'invoice.paid': {
        const invoice = event.data.object as InvoicePayload;
        await this.onInvoicePaid(invoice);
        break;
      }
      case 'payment_intent.succeeded':
      case 'payment_intent.payment_failed': {
        // Subscription state is reconciled from subscription/invoice webhooks.
        this.log.debug(`Ignored Stripe event ${event.type}`);
        break;
      }
      default:
        this.log.debug(`Unhandled Stripe event ${event.type}`);
    }
  }

  private async resolveTenantIdFromCustomer(
    customerId: string,
  ): Promise<string | null> {
    const stripe = this.stripeClient.getStripe();
    const customer = (await stripe.customers.retrieve(
      customerId,
    )) as CustomerPayload;
    if (customer.deleted) {
      return null;
    }
    const t = customer.metadata?.tenantId && String(customer.metadata.tenantId);
    return t && t.length > 0 ? t : null;
  }

  private async onCheckoutSessionCompleted(
    session: CheckoutSessionPayload,
  ): Promise<void> {
    if (session.mode !== 'subscription') {
      return;
    }
    const tenantId =
      (session.metadata?.tenantId && String(session.metadata.tenantId)) ||
      (session.client_reference_id && String(session.client_reference_id));
    if (!tenantId) {
      this.log.warn('checkout.session.completed without tenant id');
      return;
    }

    const subscriptionId =
      typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id;
    if (!subscriptionId) {
      this.log.warn('checkout.session.completed without subscription id');
      return;
    }

    const stripe = this.stripeClient.getStripe();
    const stripeSub = (await stripe.subscriptions.retrieve(
      subscriptionId,
    )) as unknown as SubscriptionPayload;
    const priceId = stripeSub.items.data[0]?.price?.id;
    if (!priceId) {
      this.log.warn('Stripe subscription missing price id');
      return;
    }

    const plan = await this.plans.findByStripePriceIdIncludingArchived(priceId);
    const currentPeriodStart = stripeUnixToDate(stripeSub.current_period_start);
    const currentPeriodEnd = stripeUnixToDate(stripeSub.current_period_end);
    const updated = await this.subscriptions.upsertForTenant({
      tenantId,
      status: stripeSub.status,
      planKey: plan ? plan.name : priceId,
      stripeCustomerId: stripeSub.customer,
      stripeSubscriptionId: stripeSub.id,
      stripePriceId: priceId,
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
    });

    const periodEndIso = toIsoOrNull(
      currentPeriodEnd ?? updated.currentPeriodEnd ?? undefined,
    );
    if (!periodEndIso) {
      this.log.warn(
        `checkout.session.completed: missing/invalid current_period_end for ${stripeSub.id}`,
      );
      return;
    }

    const checkoutPayload: BillingSubscriptionCheckoutCompletedPayload = {
      tenantId,
      stripeSubscriptionId: stripeSub.id,
      periodEndIso,
      planName: plan ? plan.name : null,
    };
    await this.eventEmitter.emitAsync(
      BillingSubscriptionEventName.CheckoutCompleted,
      checkoutPayload,
    );
  }

  private async onSubscriptionUpdated(sub: SubscriptionPayload): Promise<void> {
    let tenantId = await this.resolveTenantIdFromCustomer(sub.customer);
    const existing = await this.subscriptions.findByStripeSubscriptionId(
      sub.id,
    );
    if (!tenantId && existing) {
      tenantId = existing.tenantId;
    }
    if (!tenantId) {
      this.log.warn(`subscription.updated: no tenant for ${sub.id}`);
      return;
    }

    const priceId = sub.items.data[0]?.price?.id ?? '';
    const plan = priceId
      ? await this.plans.findByStripePriceIdIncludingArchived(priceId)
      : null;

    const currentPeriodStart = stripeUnixToDate(sub.current_period_start);
    const currentPeriodEnd = stripeUnixToDate(sub.current_period_end);
    const updated = await this.subscriptions.upsertForTenant({
      tenantId,
      status: sub.status,
      planKey: plan ? plan.name : priceId || existing?.planKey || '',
      stripeCustomerId: sub.customer,
      stripeSubscriptionId: sub.id,
      stripePriceId: priceId || undefined,
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    });

    const endIso = toIsoOrNull(
      currentPeriodEnd ?? updated.currentPeriodEnd ?? existing?.currentPeriodEnd,
    );
    if (!endIso) {
      this.log.warn(
        `subscription.updated: missing/invalid current_period_end for ${sub.id}`,
      );
      return;
    }
    const updatedPayload: BillingSubscriptionUpdatedPayload = {
      tenantId,
      stripeSubscriptionId: sub.id,
      periodEndIso: endIso,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    };
    await this.eventEmitter.emitAsync(
      BillingSubscriptionEventName.Updated,
      updatedPayload,
    );
  }

  private async onSubscriptionDeleted(sub: SubscriptionPayload): Promise<void> {
    let tenantId = await this.resolveTenantIdFromCustomer(sub.customer);
    const existing = await this.subscriptions.findByStripeSubscriptionId(
      sub.id,
    );
    if (!tenantId && existing) {
      tenantId = existing.tenantId;
    }
    if (!tenantId) {
      this.log.warn(`subscription.deleted: no tenant for ${sub.id}`);
      return;
    }

    await this.subscriptions.markCanceledByTenant(
      tenantId,
      sub.customer,
      stripeUnixToDate(sub.current_period_end),
    );

    const endedPayload: BillingSubscriptionEndedPayload = {
      tenantId,
      stripeSubscriptionId: sub.id,
    };
    await this.eventEmitter.emitAsync(
      BillingSubscriptionEventName.Ended,
      endedPayload,
    );
  }

  private async onInvoicePaymentFailed(invoice: InvoicePayload): Promise<void> {
    const customerId = invoiceCustomerId(invoice);
    if (!customerId) {
      return;
    }
    const tenantId = await this.resolveTenantIdFromCustomer(customerId);
    if (!tenantId) {
      return;
    }

    const failedPayload: BillingInvoiceNotificationPayload = {
      tenantId,
      invoiceId: invoice.id,
    };
    await this.eventEmitter.emitAsync(
      BillingSubscriptionEventName.InvoicePaymentFailed,
      failedPayload,
    );
  }

  private async onInvoicePaid(invoice: InvoicePayload): Promise<void> {
    const customerId = invoiceCustomerId(invoice);
    if (!customerId) {
      return;
    }
    const tenantId = await this.resolveTenantIdFromCustomer(customerId);
    if (!tenantId) {
      return;
    }

    const paidPayload: BillingInvoiceNotificationPayload = {
      tenantId,
      invoiceId: invoice.id,
    };
    await this.eventEmitter.emitAsync(
      BillingSubscriptionEventName.InvoicePaid,
      paidPayload,
    );
  }
}
