import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiSuccessResponse } from '../../common/types/api-response.types';
import { UserRepository } from '../../user/repositories/user.repository';
import { CancelSubscriptionDto } from '../dto/cancel-subscription.dto';
import { CreateCheckoutSessionDto } from '../dto/create-checkout-session.dto';
import { RequestRefundDto } from '../dto/request-refund.dto';
import { SubscriptionPlanRepository } from '../repositories/subscription-plan.repository';
import { SubscriptionRepository } from '../repositories/subscription.repository';
import { StripeClientService } from './stripe-client.service';
import { sortSubscriptionPlansByDisplayOrder } from '../utils/subscription-plan-display-order.util';
import type { AuthenticatedRequestUser } from '../../auth/types/auth-request-user.types';

type CheckoutSessionPayload = {
  status?: string | null;
  client_reference_id?: string | null;
  metadata?: Record<string, string> | null;
  subscription?: string | { id?: string } | null;
};

type StripeSubscriptionPayload = {
  id: string;
  customer: string | { id?: string } | null;
  status: string;
  current_period_start: number;
  current_period_end: number;
  cancel_at_period_end: boolean;
  items: { data: Array<{ price?: { id?: string } | null }> };
};

type StripeInvoicePayload = {
  id: string;
  charge?: string | null;
  payment_intent?: string | { id?: string } | null;
};

type StripePaymentIntentPayload = {
  id: string;
  latest_charge?: string | { id?: string } | null;
};

type StripeUpcomingInvoicePayload = {
  next_payment_attempt?: number | null;
  lines?: {
    data?: Array<{
      period?: {
        end?: number;
      } | null;
    }>;
  } | null;
};

type TenantSubscriptionPlanSummary = {
  id: string;
  name: string;
  amount: number;
  currency: string;
  interval: string;
  trialDays: number;
  isTrialEnabled: boolean;
  featureHighlights: string[];
};

type BillingPlanFeatureLimits = {
  maxWorkspaces?: number;
  maxUsers?: number;
  maxFileAssets?: number;
  maxStorageMb?: number;
};

@Injectable()
export class TenantBillingService {
  constructor(
    private readonly configService: ConfigService,
    private readonly stripeClient: StripeClientService,
    private readonly plans: SubscriptionPlanRepository,
    private readonly subscriptions: SubscriptionRepository,
    private readonly users: UserRepository,
  ) {}

  private frontendBase(): string {
    return this.configService
      .get<string>('FRONTEND_HOST', 'http://localhost:5173')
      .replace(/\/$/, '');
  }

  async listPublicPlans(): Promise<
    ApiSuccessResponse<
      Array<{
        id: string;
        name: string;
        stripePriceId: string;
        amount: number;
        currency: string;
        interval: string;
        trialDays: number;
        isTrialEnabled: boolean;
        features: BillingPlanFeatureLimits | null;
        featureHighlights: string[];
      }>
    >
  > {
    const rows = sortSubscriptionPlansByDisplayOrder(
      await this.plans.findMany({ includeArchived: false }),
    );
    return {
      success: true,
      message: 'OK',
      data: rows.map((p) => ({
        id: String(p._id),
        name: p.name,
        stripePriceId: p.stripePriceId,
        amount: p.amount,
        currency: p.currency,
        interval: p.interval,
        trialDays: p.trialDays,
        isTrialEnabled: p.isTrialEnabled,
        features: p.features
          ? {
              ...(typeof p.features.maxWorkspaces === 'number'
                ? { maxWorkspaces: p.features.maxWorkspaces }
                : {}),
              ...(typeof p.features.maxUsers === 'number'
                ? { maxUsers: p.features.maxUsers }
                : {}),
              ...(typeof p.features.maxFileAssets === 'number'
                ? { maxFileAssets: p.features.maxFileAssets }
                : {}),
              ...(typeof p.features.maxStorageMb === 'number'
                ? { maxStorageMb: p.features.maxStorageMb }
                : {}),
            }
          : null,
        featureHighlights: this.toFeatureHighlights(p.features),
      })),
    };
  }

  async getTenantSubscription(tenantId: string): Promise<
    ApiSuccessResponse<{
      tenantId: string;
      status: string;
      planKey: string;
      stripePriceId?: string;
      stripeSubscriptionId?: string;
      currentPeriodStart?: string;
      currentPeriodEnd?: string;
      cancelAtPeriodEnd: boolean;
      nextBillingDate?: string;
      nextBillingInDays?: number;
      plan: TenantSubscriptionPlanSummary | null;
    }>
  > {
    const doc = await this.subscriptions.findByTenantId(tenantId);
    if (!doc) {
      return {
        success: true,
        message: 'No billing record for tenant yet',
        data: {
          tenantId,
          status: 'inactive',
          planKey: '',
          cancelAtPeriodEnd: false,
          plan: null,
        },
      };
    }

    let effectiveStatus = doc.status;
    let effectivePlanKey = doc.planKey;
    let effectiveStripePriceId = doc.stripePriceId;
    let effectiveStripeSubscriptionId = doc.stripeSubscriptionId;
    let effectiveCurrentPeriodStart = doc.currentPeriodStart;
    let effectiveCurrentPeriodEnd = doc.currentPeriodEnd;
    let effectiveCancelAtPeriodEnd = doc.cancelAtPeriodEnd ?? false;

    const shouldBackfillTimelineFromStripe =
      !effectiveCurrentPeriodStart ||
      !effectiveCurrentPeriodEnd ||
      (typeof effectiveStripePriceId !== 'string' || effectiveStripePriceId.length === 0);

    if (shouldBackfillTimelineFromStripe) {
      const stripeSub = await this.resolveStripeSubscriptionForTenant(doc);
      if (stripeSub) {
        const stripePriceId = stripeSub.items.data[0]?.price?.id;
        effectiveStripeSubscriptionId = stripeSub.id;
        effectiveStatus = stripeSub.status;
        effectiveCurrentPeriodStart = this.toDateFromStripeUnix(
          stripeSub.current_period_start,
        );
        effectiveCurrentPeriodEnd = this.toDateFromStripeUnix(
          stripeSub.current_period_end,
        );
        effectiveCancelAtPeriodEnd = stripeSub.cancel_at_period_end === true;
        if (typeof stripePriceId === 'string' && stripePriceId.length > 0) {
          effectiveStripePriceId = stripePriceId;
          const mappedPlan = await this.plans.findByStripePriceIdIncludingArchived(
            stripePriceId,
          );
          if (mappedPlan) {
            effectivePlanKey = mappedPlan.name;
          } else if (effectivePlanKey.trim().length === 0) {
            effectivePlanKey = stripePriceId;
          }
        }

        await this.subscriptions.upsertForTenant({
          tenantId: doc.tenantId,
          status: effectiveStatus,
          planKey: effectivePlanKey,
          stripeCustomerId: doc.stripeCustomerId,
          stripeSubscriptionId: effectiveStripeSubscriptionId,
          stripePriceId:
            typeof effectiveStripePriceId === 'string' &&
            effectiveStripePriceId.length > 0
              ? effectiveStripePriceId
              : undefined,
          currentPeriodStart: effectiveCurrentPeriodStart,
          currentPeriodEnd: effectiveCurrentPeriodEnd,
          cancelAtPeriodEnd: effectiveCancelAtPeriodEnd,
        });
      }
    }

    if (
      !effectiveCurrentPeriodEnd &&
      typeof doc.stripeCustomerId === 'string' &&
      doc.stripeCustomerId.length > 0 &&
      typeof effectiveStripeSubscriptionId === 'string' &&
      effectiveStripeSubscriptionId.length > 0
    ) {
      const fallbackNextBilling = await this.resolveNextBillingFromUpcomingInvoice(
        doc.stripeCustomerId,
        effectiveStripeSubscriptionId,
      );
      if (fallbackNextBilling) {
        effectiveCurrentPeriodEnd = fallbackNextBilling;
        await this.subscriptions.upsertForTenant({
          tenantId: doc.tenantId,
          status: effectiveStatus,
          planKey: effectivePlanKey,
          stripeCustomerId: doc.stripeCustomerId,
          stripeSubscriptionId: effectiveStripeSubscriptionId,
          stripePriceId:
            typeof effectiveStripePriceId === 'string' &&
            effectiveStripePriceId.length > 0
              ? effectiveStripePriceId
              : undefined,
          currentPeriodStart: effectiveCurrentPeriodStart,
          currentPeriodEnd: effectiveCurrentPeriodEnd,
          cancelAtPeriodEnd: effectiveCancelAtPeriodEnd,
        });
      }
    }

    const currentPeriodEnd = effectiveCurrentPeriodEnd;
    const nextBilling =
      currentPeriodEnd instanceof Date
        ? this.toNextBilling(currentPeriodEnd)
        : undefined;

    const planDoc =
      typeof effectiveStripePriceId === 'string' && effectiveStripePriceId.length > 0
        ? await this.plans.findByStripePriceIdIncludingArchived(effectiveStripePriceId)
        : null;

    return {
      success: true,
      message: 'OK',
      data: {
        tenantId: doc.tenantId,
        status: effectiveStatus,
        planKey: effectivePlanKey,
        stripePriceId: effectiveStripePriceId,
        stripeSubscriptionId: effectiveStripeSubscriptionId,
        currentPeriodStart: effectiveCurrentPeriodStart?.toISOString(),
        currentPeriodEnd: currentPeriodEnd?.toISOString(),
        cancelAtPeriodEnd: effectiveCancelAtPeriodEnd,
        nextBillingDate: nextBilling?.nextBillingDate,
        nextBillingInDays: nextBilling?.nextBillingInDays,
        plan: planDoc
          ? {
              id: String(planDoc._id),
              name: planDoc.name,
              amount: planDoc.amount,
              currency: planDoc.currency,
              interval: planDoc.interval,
              trialDays: planDoc.trialDays,
              isTrialEnabled: planDoc.isTrialEnabled,
              featureHighlights: this.toFeatureHighlights(planDoc.features),
            }
          : null,
      },
    };
  }

  async createCheckoutSession(
    user: AuthenticatedRequestUser,
    dto: CreateCheckoutSessionDto,
  ): Promise<ApiSuccessResponse<{ sessionId: string; url: string | null }>> {
    if (user.platformAdmin) {
      throw new BadRequestException(
        'Platform operators subscribe via a separate flow (no tenant context).',
      );
    }

    const plan = await this.plans.findByStripePriceId(dto.stripePriceId);
    if (!plan) {
      throw new NotFoundException('Unknown or inactive subscription price');
    }

    const stripe = this.stripeClient.getStripe();
    const u = await this.users.findById(user.userId);
    if (!u) {
      throw new NotFoundException('User not found');
    }

    let customerId = (await this.subscriptions.findByTenantId(user.tenantId))
      ?.stripeCustomerId;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: u.email,
        metadata: { tenantId: user.tenantId, userId: user.userId },
      });
      const newCustomerId = customer.id;
      if (!newCustomerId) {
        throw new BadRequestException(
          'Stripe customer id missing from response',
        );
      }
      customerId = newCustomerId;
      await this.subscriptions.setStripeCustomerId(user.tenantId, customerId);
    } else {
      await stripe.customers.update(customerId, {
        metadata: { tenantId: user.tenantId, userId: user.userId },
      });
    }

    const base = this.frontendBase();
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: user.tenantId,
      line_items: [{ price: dto.stripePriceId, quantity: 1 }],
      success_url: `${base}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/billing/cancel?session_id={CHECKOUT_SESSION_ID}`,
      metadata: {
        tenantId: user.tenantId,
        userId: user.userId,
      },
      subscription_data:
        plan.isTrialEnabled && plan.trialDays > 0
          ? { trial_period_days: plan.trialDays }
          : undefined,
    });

    return {
      success: true,
      message: 'Checkout session created',
      data: { sessionId: session.id, url: session.url },
    };
  }

  async confirmCheckoutSession(
    user: AuthenticatedRequestUser,
    sessionId: string,
  ): Promise<
    ApiSuccessResponse<{
      sessionId: string;
      synced: boolean;
      subscriptionStatus: string;
      planKey: string;
      cancelAtPeriodEnd: boolean;
    }>
  > {
    if (user.platformAdmin) {
      throw new BadRequestException(
        'Platform operators subscribe via a separate flow (no tenant context).',
      );
    }
    if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
      throw new BadRequestException('Checkout session id is required');
    }

    const stripe = this.stripeClient.getStripe();
    const normalizedSessionId = sessionId.trim();
    const checkoutSession = await stripe.checkout.sessions.retrieve(
      normalizedSessionId,
    );
    const checkout = checkoutSession as unknown as CheckoutSessionPayload;

    const checkoutTenantId = this.readCheckoutTenantId(checkout);
    if (checkoutTenantId !== user.tenantId) {
      throw new ForbiddenException('Checkout session does not belong to this tenant');
    }

    const subscriptionId = this.readCheckoutSubscriptionId(checkout);
    if (!subscriptionId) {
      return {
        success: true,
        message: 'Checkout session not finalized yet',
        data: {
          sessionId: normalizedSessionId,
          synced: false,
          subscriptionStatus: String(checkout.status ?? 'open'),
          planKey: '',
          cancelAtPeriodEnd: false,
        },
      };
    }

    const stripeSubscription = (await stripe.subscriptions.retrieve(
      subscriptionId,
    )) as unknown as StripeSubscriptionPayload;
    const stripePriceId = stripeSubscription.items.data[0]?.price?.id;
    const plan = stripePriceId
      ? await this.plans.findByStripePriceIdIncludingArchived(stripePriceId)
      : null;
    const stripeCustomerId = this.readStripeCustomerId(stripeSubscription.customer);

    await this.subscriptions.upsertForTenant({
      tenantId: user.tenantId,
      status: stripeSubscription.status,
      planKey: plan ? plan.name : stripePriceId ?? '',
      stripeCustomerId:
        typeof stripeCustomerId === 'string' && stripeCustomerId.length > 0
          ? stripeCustomerId
          : undefined,
      stripeSubscriptionId: stripeSubscription.id,
      stripePriceId: stripePriceId ?? undefined,
      currentPeriodStart: this.toDateFromStripeUnix(
        stripeSubscription.current_period_start,
      ),
      currentPeriodEnd: this.toDateFromStripeUnix(
        stripeSubscription.current_period_end,
      ),
      cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end === true,
    });

    return {
      success: true,
      message: 'Checkout session synchronized',
      data: {
        sessionId: normalizedSessionId,
        synced: true,
        subscriptionStatus: stripeSubscription.status,
        planKey: plan ? plan.name : stripePriceId ?? '',
        cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end === true,
      },
    };
  }

  async createBillingPortalSession(
    user: AuthenticatedRequestUser,
  ): Promise<ApiSuccessResponse<{ url: string }>> {
    if (user.platformAdmin) {
      throw new BadRequestException(
        'Billing portal requires a tenant subscription',
      );
    }

    const sub = await this.subscriptions.findByTenantId(user.tenantId);
    if (!sub?.stripeCustomerId) {
      throw new BadRequestException(
        'No Stripe customer on file; start checkout first.',
      );
    }

    const stripe = this.stripeClient.getStripe();
    const base = this.frontendBase();
    const portal = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${base}/billing`,
    });
    return {
      success: true,
      message: 'Billing portal session created',
      data: { url: portal.url },
    };
  }

  async cancelSubscription(
    user: AuthenticatedRequestUser,
    dto: CancelSubscriptionDto,
  ): Promise<
    ApiSuccessResponse<{
      canceledNow: boolean;
      status: string;
      cancelAtPeriodEnd: boolean;
      stripeSubscriptionId: string;
      currentPeriodEnd?: string;
    }>
  > {
    if (user.platformAdmin) {
      throw new BadRequestException(
        'Platform operators do not have tenant subscriptions to cancel.',
      );
    }

    const tenantSub = await this.subscriptions.findByTenantId(user.tenantId);
    const stripeSubscriptionId = tenantSub?.stripeSubscriptionId;
    if (!tenantSub || !stripeSubscriptionId) {
      throw new NotFoundException('No active Stripe subscription found for tenant');
    }

    const stripe = this.stripeClient.getStripe();
    const immediate = dto.immediate === true;

    if (immediate) {
      const canceled = (await stripe.subscriptions.cancel(
        stripeSubscriptionId,
      )) as unknown as StripeSubscriptionPayload;
      await this.subscriptions.upsertForTenant({
        tenantId: user.tenantId,
        status: canceled.status,
        planKey: tenantSub.planKey,
        stripeCustomerId: tenantSub.stripeCustomerId,
        stripeSubscriptionId: canceled.id,
        stripePriceId: tenantSub.stripePriceId,
        currentPeriodStart: this.toDateFromStripeUnix(
          canceled.current_period_start,
        ),
        currentPeriodEnd: this.toDateFromStripeUnix(canceled.current_period_end),
        cancelAtPeriodEnd: false,
      });
      return {
        success: true,
        message: 'Subscription canceled immediately',
        data: {
          canceledNow: true,
          status: canceled.status,
          cancelAtPeriodEnd: false,
          stripeSubscriptionId: canceled.id,
          currentPeriodEnd: this.toDateFromStripeUnix(
            canceled.current_period_end,
          )?.toISOString(),
        },
      };
    }

    const updated = (await stripe.subscriptions.update(stripeSubscriptionId, {
      cancel_at_period_end: true,
    })) as unknown as StripeSubscriptionPayload;
    await this.subscriptions.upsertForTenant({
      tenantId: user.tenantId,
      status: updated.status,
      planKey: tenantSub.planKey,
      stripeCustomerId: tenantSub.stripeCustomerId,
      stripeSubscriptionId: updated.id,
      stripePriceId: tenantSub.stripePriceId,
      currentPeriodStart: this.toDateFromStripeUnix(updated.current_period_start),
      currentPeriodEnd: this.toDateFromStripeUnix(updated.current_period_end),
      cancelAtPeriodEnd: updated.cancel_at_period_end === true,
    });
    return {
      success: true,
      message: 'Subscription scheduled for cancellation at period end',
      data: {
        canceledNow: false,
        status: updated.status,
        cancelAtPeriodEnd: updated.cancel_at_period_end === true,
        stripeSubscriptionId: updated.id,
        currentPeriodEnd: this.toDateFromStripeUnix(
          updated.current_period_end,
        )?.toISOString(),
      },
    };
  }

  async requestRefund(
    user: AuthenticatedRequestUser,
    dto: RequestRefundDto,
  ): Promise<
    ApiSuccessResponse<{
      refundId: string;
      status: string | null;
      chargeId: string;
      amount: number;
      currency: string;
    }>
  > {
    if (user.platformAdmin) {
      throw new BadRequestException(
        'Platform operators do not have tenant subscriptions to refund.',
      );
    }

    const tenantSub = await this.subscriptions.findByTenantId(user.tenantId);
    const stripeSubscriptionId = tenantSub?.stripeSubscriptionId;
    const stripeCustomerId = tenantSub?.stripeCustomerId;
    if (!tenantSub || !stripeSubscriptionId || !stripeCustomerId) {
      throw new NotFoundException('No billable tenant subscription found');
    }

    const stripe = this.stripeClient.getStripe();
    const invoices = await stripe.invoices.list({
      customer: stripeCustomerId,
      subscription: stripeSubscriptionId,
      status: 'paid',
      limit: 10,
    });
    const latestPaidInvoice = invoices.data[0] as unknown as
      | StripeInvoicePayload
      | undefined;
    if (!latestPaidInvoice) {
      throw new BadRequestException('No paid invoice available for refund');
    }

    const chargeId = await this.resolveInvoiceChargeId(latestPaidInvoice);
    if (!chargeId) {
      throw new ServiceUnavailableException(
        'Paid invoice does not expose a refundable charge',
      );
    }

    const refund = await stripe.refunds.create({
      charge: chargeId,
      reason: 'requested_by_customer',
      metadata: {
        tenantId: user.tenantId,
        userId: user.userId,
        ...(dto.note ? { note: dto.note } : {}),
      },
    });

    return {
      success: true,
      message: 'Refund requested successfully',
      data: {
        refundId: refund.id,
        status: refund.status,
        chargeId,
        amount: refund.amount,
        currency: refund.currency,
      },
    };
  }

  private readCheckoutTenantId(session: CheckoutSessionPayload): string {
    const fromClientRef =
      typeof session.client_reference_id === 'string'
        ? session.client_reference_id
        : null;
    const fromMetadata =
      typeof session.metadata?.tenantId === 'string'
        ? session.metadata.tenantId
        : null;
    const tenantId = fromClientRef ?? fromMetadata;
    if (!tenantId || tenantId.length === 0) {
      throw new BadRequestException('Checkout session missing tenant context');
    }
    return tenantId;
  }

  private readCheckoutSubscriptionId(
    session: CheckoutSessionPayload,
  ): string | null {
    if (typeof session.subscription === 'string') {
      return session.subscription;
    }
    const maybeObject = session.subscription;
    if (
      maybeObject &&
      typeof maybeObject === 'object' &&
      typeof maybeObject.id === 'string'
    ) {
      return maybeObject.id;
    }
    return null;
  }

  private readStripeCustomerId(
    customer: string | { id?: string } | null,
  ): string | null {
    if (typeof customer === 'string') {
      return customer;
    }
    if (customer && typeof customer.id === 'string') {
      return customer.id;
    }
    return null;
  }

  private toDateFromStripeUnix(value: number | null | undefined): Date | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return undefined;
    }
    return new Date(value * 1000);
  }

  private toNextBilling(periodEnd: Date): {
    nextBillingDate: string;
    nextBillingInDays: number;
  } {
    const nowMs = Date.now();
    const billingMs = periodEnd.getTime();
    const msUntilBilling = billingMs - nowMs;
    const daysUntilBilling = Math.max(0, Math.ceil(msUntilBilling / 86_400_000));
    return {
      nextBillingDate: periodEnd.toISOString(),
      nextBillingInDays: daysUntilBilling,
    };
  }

  private toFeatureHighlights(
    features: BillingPlanFeatureLimits | null | undefined,
  ): string[] {
    if (!features) {
      return [];
    }

    const highlights: string[] = [];
    if (typeof features.maxWorkspaces === 'number') {
      highlights.push(`${features.maxWorkspaces} workspaces`);
    }
    if (typeof features.maxUsers === 'number') {
      highlights.push(`${features.maxUsers} users`);
    }
    if (typeof features.maxFileAssets === 'number') {
      highlights.push(`${features.maxFileAssets} file assets`);
    }
    if (typeof features.maxStorageMb === 'number') {
      highlights.push(`${features.maxStorageMb} MB storage`);
    }
    return highlights;
  }

  private async resolveInvoiceChargeId(
    invoice: StripeInvoicePayload,
  ): Promise<string | null> {
    if (typeof invoice.charge === 'string' && invoice.charge.length > 0) {
      return invoice.charge;
    }
    const paymentIntentId = this.readStripeId(invoice.payment_intent);
    if (!paymentIntentId) {
      return null;
    }
    const stripe = this.stripeClient.getStripe();
    const paymentIntent = (await stripe.paymentIntents.retrieve(
      paymentIntentId,
    )) as unknown as StripePaymentIntentPayload;
    return this.readStripeId(paymentIntent.latest_charge);
  }

  private async resolveStripeSubscriptionForTenant(doc: {
    stripeSubscriptionId?: string;
    stripeCustomerId?: string;
  }): Promise<StripeSubscriptionPayload | null> {
    const stripe = this.stripeClient.getStripe();

    if (
      typeof doc.stripeSubscriptionId === 'string' &&
      doc.stripeSubscriptionId.length > 0
    ) {
      try {
        const stripeSub = (await stripe.subscriptions.retrieve(
          doc.stripeSubscriptionId,
        )) as unknown as StripeSubscriptionPayload;
        return stripeSub;
      } catch {
        // fall through to customer listing lookup
      }
    }

    if (
      typeof doc.stripeCustomerId !== 'string' ||
      doc.stripeCustomerId.length === 0
    ) {
      return null;
    }

    const list = await stripe.subscriptions.list({
      customer: doc.stripeCustomerId,
      status: 'all',
      limit: 10,
    });

    const rows = list.data as unknown as StripeSubscriptionPayload[];
    if (rows.length === 0) {
      return null;
    }

    const rank = (status: string): number => {
      const normalized = status.trim().toLowerCase();
      if (normalized === 'active' || normalized === 'trialing') return 4;
      if (normalized === 'past_due' || normalized === 'unpaid') return 3;
      if (normalized === 'incomplete' || normalized === 'incomplete_expired') {
        return 2;
      }
      if (normalized === 'canceled') return 1;
      return 0;
    };

    const sorted = [...rows].sort((a, b) => {
      const rankDiff = rank(b.status) - rank(a.status);
      if (rankDiff !== 0) {
        return rankDiff;
      }
      return b.current_period_end - a.current_period_end;
    });

    return sorted[0] ?? null;
  }

  private async resolveNextBillingFromUpcomingInvoice(
    stripeCustomerId: string,
    stripeSubscriptionId: string,
  ): Promise<Date | undefined> {
    const stripe = this.stripeClient.getStripe();
    try {
      const upcoming = (await stripe.invoices.createPreview({
        customer: stripeCustomerId,
        subscription: stripeSubscriptionId,
      })) as unknown as StripeUpcomingInvoicePayload;

      const nextPaymentAttempt = upcoming.next_payment_attempt;
      if (typeof nextPaymentAttempt === 'number' && Number.isFinite(nextPaymentAttempt)) {
        return new Date(nextPaymentAttempt * 1000);
      }

      const linePeriodEnd = upcoming.lines?.data?.[0]?.period?.end;
      if (typeof linePeriodEnd === 'number' && Number.isFinite(linePeriodEnd)) {
        return new Date(linePeriodEnd * 1000);
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  private readStripeId(
    value: string | { id?: string } | null | undefined,
  ): string | null {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
    if (
      value &&
      typeof value === 'object' &&
      typeof value.id === 'string' &&
      value.id.length > 0
    ) {
      return value.id;
    }
    return null;
  }
}
