import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  BillingSubscriptionEventName,
  type BillingInvoiceNotificationPayload,
  type BillingSubscriptionCheckoutCompletedPayload,
  type BillingSubscriptionEndedPayload,
  type BillingSubscriptionUpdatedPayload,
} from '../../common/domain-events/billing-subscription.domain-events';
import { UserRepository } from '../../user/repositories/user.repository';
import { EmailService } from '../email.service';
import { formatIsoForEmail } from '../utils/transactional-email-layout.util';

@Injectable()
export class BillingSubscriptionEmailListener {
  private readonly log = new Logger(BillingSubscriptionEmailListener.name);

  constructor(
    private readonly email: EmailService,
    private readonly users: UserRepository,
  ) {}

  @OnEvent(BillingSubscriptionEventName.CheckoutCompleted)
  async onCheckoutCompleted(
    payload: BillingSubscriptionCheckoutCompletedPayload,
  ): Promise<void> {
    const to = await this.users.findEarliestUserEmailByTenantId(
      payload.tenantId,
    );
    if (!to) {
      this.log.warn(
        `checkout_completed email skipped: no user email for tenant ${payload.tenantId}`,
      );
      return;
    }
    const brand = this.email.platformBrand();
    const periodLabel = formatIsoForEmail(payload.periodEndIso);
    const planSentence = payload.planName
      ? `Your current plan is "${payload.planName}".`
      : 'Your subscription is now active.';
    await this.email.sendPlatformTransactional({
      to,
      subjectLine: 'Subscription confirmed',
      headline: 'Your subscription is live',
      bodyLines: [
        `${planSentence} Billing for this workspace is managed through ${brand}.`,
        `Your current period ends on ${periodLabel} (server time).`,
        'You can update payment methods or invoices anytime from the billing area in your app.',
      ],
    });
  }

  @OnEvent(BillingSubscriptionEventName.Updated)
  async onUpdated(payload: BillingSubscriptionUpdatedPayload): Promise<void> {
    const to = await this.users.findEarliestUserEmailByTenantId(
      payload.tenantId,
    );
    if (!to) return;
    const brand = this.email.platformBrand();
    const periodLabel = formatIsoForEmail(payload.periodEndIso);
    if (payload.cancelAtPeriodEnd) {
      await this.email.sendPlatformTransactional({
        to,
        subjectLine: 'Cancellation scheduled',
        headline: 'Your subscription will end after the current period',
        bodyLines: [
          'A cancellation has been scheduled with your payment provider.',
          `Your workspace keeps access until ${periodLabel}. After that, paid features may be unavailable until you subscribe again.`,
          `If this was unexpected, sign in and review billing settings for your ${brand} workspace.`,
        ],
      });
    } else {
      await this.email.sendPlatformTransactional({
        to,
        subjectLine: 'Subscription updated',
        headline: 'Your subscription details changed',
        bodyLines: [
          'We recorded an update to your subscription (for example plan, quantity, or renewal).',
          `Your current billing period ends on ${periodLabel}.`,
          `No action is required unless you plan to change plans; manage everything under billing in your ${brand} workspace.`,
        ],
      });
    }
  }

  @OnEvent(BillingSubscriptionEventName.Ended)
  async onEnded(payload: BillingSubscriptionEndedPayload): Promise<void> {
    const to = await this.users.findEarliestUserEmailByTenantId(
      payload.tenantId,
    );
    if (!to) return;
    const brand = this.email.platformBrand();
    await this.email.sendPlatformTransactional({
      to,
      subjectLine: 'Subscription ended',
      headline: 'Your paid subscription has ended',
      bodyLines: [
        'This workspace no longer has an active paid subscription.',
        'You can start a new subscription from the billing section whenever you are ready to restore paid features.',
        `Thank you for using ${brand}.`,
      ],
    });
  }

  @OnEvent(BillingSubscriptionEventName.InvoicePaymentFailed)
  async onInvoicePaymentFailed(
    payload: BillingInvoiceNotificationPayload,
  ): Promise<void> {
    const to = await this.users.findEarliestUserEmailByTenantId(
      payload.tenantId,
    );
    if (!to) return;
    const brand = this.email.platformBrand();
    await this.email.sendPlatformTransactional({
      to,
      subjectLine: 'Action needed — payment failed',
      headline: 'We could not process your latest invoice',
      bodyLines: [
        `A subscription invoice could not be charged successfully (reference: ${payload.invoiceId}).`,
        'To avoid interruption, please open the billing portal in your app and update your payment method.',
        `This is an automated message from ${brand}.`,
      ],
    });
  }

  @OnEvent(BillingSubscriptionEventName.InvoicePaid)
  async onInvoicePaid(
    payload: BillingInvoiceNotificationPayload,
  ): Promise<void> {
    const to = await this.users.findEarliestUserEmailByTenantId(
      payload.tenantId,
    );
    if (!to) return;
    await this.email.sendPlatformTransactional({
      to,
      subjectLine: 'Payment received — thank you',
      headline: 'Your payment was successful',
      bodyLines: [
        'Thank you. We have received your subscription payment.',
        `Invoice reference: ${payload.invoiceId}.`,
      ],
    });
  }
}
