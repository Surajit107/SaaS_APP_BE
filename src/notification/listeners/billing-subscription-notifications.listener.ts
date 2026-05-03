import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  BillingSubscriptionEventName,
  type BillingInvoiceNotificationPayload,
  type BillingSubscriptionCheckoutCompletedPayload,
  type BillingSubscriptionEndedPayload,
  type BillingSubscriptionUpdatedPayload,
} from '../../common/domain-events/billing-subscription.domain-events';
import { NotificationService } from '../notification.service';

/**
 * Reacts to persisted subscription billing state (after Stripe webhook handlers write Mongo).
 * Keeps StripeWebhookService free of NotificationService coupling.
 */
@Injectable()
export class BillingSubscriptionNotificationsListener {
  private readonly log = new Logger(
    BillingSubscriptionNotificationsListener.name,
  );

  constructor(private readonly notifications: NotificationService) {}

  @OnEvent(BillingSubscriptionEventName.CheckoutCompleted)
  async onCheckoutCompleted(
    payload: BillingSubscriptionCheckoutCompletedPayload,
  ): Promise<void> {
    try {
      await this.notifications.notifyTenant({
        tenantId: payload.tenantId,
        type: 'subscription_checkout_completed',
        title: 'Subscription activated',
        body: payload.planName
          ? `Your organization is now on the "${payload.planName}" plan.`
          : 'Your subscription is active.',
        metadata: {
          stripeSubscriptionId: payload.stripeSubscriptionId,
          periodEnd: payload.periodEndIso,
        },
      });
    } catch (err) {
      this.log.error(
        err instanceof Error ? err.message : 'checkout_completed notify failed',
        err instanceof Error ? err.stack : undefined,
      );
    }
  }

  @OnEvent(BillingSubscriptionEventName.Updated)
  async onUpdated(payload: BillingSubscriptionUpdatedPayload): Promise<void> {
    try {
      const title = payload.cancelAtPeriodEnd
        ? 'Subscription scheduled to cancel'
        : 'Subscription updated';
      const body = payload.cancelAtPeriodEnd
        ? `Access remains until ${payload.periodEndIso}.`
        : `Current period ends ${payload.periodEndIso}.`;
      await this.notifications.notifyTenant({
        tenantId: payload.tenantId,
        type: 'subscription_updated',
        title,
        body,
        metadata: {
          stripeSubscriptionId: payload.stripeSubscriptionId,
          periodEnd: payload.periodEndIso,
          cancelAtPeriodEnd: payload.cancelAtPeriodEnd,
        },
      });
    } catch (err) {
      this.log.error(
        err instanceof Error
          ? err.message
          : 'subscription_updated notify failed',
        err instanceof Error ? err.stack : undefined,
      );
    }
  }

  @OnEvent(BillingSubscriptionEventName.Ended)
  async onEnded(payload: BillingSubscriptionEndedPayload): Promise<void> {
    try {
      await this.notifications.notifyTenant({
        tenantId: payload.tenantId,
        type: 'subscription_ended',
        title: 'Subscription ended',
        body: 'Your subscription has ended. Renew from billing to restore access.',
        metadata: { stripeSubscriptionId: payload.stripeSubscriptionId },
      });
    } catch (err) {
      this.log.error(
        err instanceof Error ? err.message : 'subscription_ended notify failed',
        err instanceof Error ? err.stack : undefined,
      );
    }
  }

  @OnEvent(BillingSubscriptionEventName.InvoicePaymentFailed)
  async onInvoicePaymentFailed(
    payload: BillingInvoiceNotificationPayload,
  ): Promise<void> {
    try {
      await this.notifications.notifyTenant({
        tenantId: payload.tenantId,
        type: 'invoice_payment_failed',
        title: 'Invoice payment failed',
        body: 'Stripe could not charge the card on file. Update your payment method in the billing portal.',
        metadata: { invoiceId: payload.invoiceId },
      });
    } catch (err) {
      this.log.error(
        err instanceof Error
          ? err.message
          : 'invoice_payment_failed notify failed',
        err instanceof Error ? err.stack : undefined,
      );
    }
  }

  @OnEvent(BillingSubscriptionEventName.InvoicePaid)
  async onInvoicePaid(
    payload: BillingInvoiceNotificationPayload,
  ): Promise<void> {
    try {
      await this.notifications.notifyTenant({
        tenantId: payload.tenantId,
        type: 'invoice_paid',
        title: 'Invoice paid',
        body: 'Thanks — your subscription payment posted successfully.',
        metadata: { invoiceId: payload.invoiceId },
      });
    } catch (err) {
      this.log.error(
        err instanceof Error ? err.message : 'invoice_paid notify failed',
        err instanceof Error ? err.stack : undefined,
      );
    }
  }
}
