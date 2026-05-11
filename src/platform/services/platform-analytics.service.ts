import { Injectable } from '@nestjs/common';
import { SubscriptionRepository } from '../../billing/repositories/subscription.repository';
import type { ApiSuccessResponse } from '../../common/types/api-response.types';
import { TenantRepository } from '../../tenant/repositories/tenant.repository';
import { UserRepository } from '../../user/repositories/user.repository';
import type {
  MrrByCurrency,
  NewMrrBucket,
  PlanDistributionRow,
  PlatformAnalyticsResponseData,
  PlatformAnalyticsTotals,
  SubscriptionStatusSlice,
  TenantGrowthBucket,
} from '../types/platform-analytics.types';

/**
 * Subscription rows that count as "live revenue contributors" for MRR/ARR.
 * Trialing is included to mirror Stripe's billable run-rate convention; if the
 * product wants strict realized-only revenue, drop `trialing` here.
 */
const ACTIVE_STATUSES: readonly string[] = ['active', 'trialing'] as const;

/** Subscriptions that are headed toward churn or already failed but not yet cancelled. */
const AT_RISK_STATUSES: ReadonlySet<string> = new Set([
  'past_due',
  'unpaid',
  'incomplete',
  'incomplete_expired',
  'paused',
]);

const CANCELED_STATUSES: ReadonlySet<string> = new Set(['canceled']);

/**
 * Aggregates the platform operator dashboard analytics directly from primary
 * collections. No materialized views, no scheduled snapshotters — every fetch
 * is a fresh aggregation, sized to the configured `range`.
 */
@Injectable()
export class PlatformAnalyticsService {
  constructor(
    private readonly tenantRepository: TenantRepository,
    private readonly userRepository: UserRepository,
    private readonly subscriptionRepository: SubscriptionRepository,
  ) {}

  async getAnalytics(
    days: number,
  ): Promise<ApiSuccessResponse<PlatformAnalyticsResponseData>> {
    const to = new Date();
    const from = new Date(to.getTime());
    from.setUTCHours(0, 0, 0, 0);
    from.setUTCDate(from.getUTCDate() - (days - 1));

    const [
      tenantsActive,
      tenantsPendingPurge,
      tenantsDeleted,
      tenantsCreatedBefore,
      userCount,
      dailySignups,
      statusHistogram,
      planDistribution,
      newMrrBuckets,
    ] = await Promise.all([
      this.tenantRepository.countActiveForPlatformAdmin(),
      this.tenantRepository.countPendingPurgeForPlatformAdmin(),
      this.tenantRepository.countDeletedForPlatformAdmin(),
      this.tenantRepository.countCreatedBeforeForPlatformAdmin(from),
      this.userRepository.countAllForPlatformAdmin(),
      this.tenantRepository.aggregateDailySignupsForPlatformAdmin(from),
      this.subscriptionRepository.aggregateStatusHistogramForPlatformAdmin(),
      this.subscriptionRepository.aggregatePlanDistributionForPlatformAdmin(
        ACTIVE_STATUSES,
      ),
      this.subscriptionRepository.aggregateDailyNewMrrForPlatformAdmin(from),
    ]);

    const totals = this.computeTotals({
      tenantsActive,
      tenantsPendingPurge,
      tenantsDeleted,
      userCount,
      statusHistogram,
      planDistribution,
    });

    return {
      success: true,
      message: 'OK',
      data: {
        range: {
          days,
          from: from.toISOString(),
          to: to.toISOString(),
        },
        totals,
        tenantGrowth: this.densifyTenantGrowth(
          from,
          days,
          tenantsCreatedBefore,
          dailySignups,
        ),
        subscriptionStatus: statusHistogram,
        planDistribution,
        newMrrByDay: this.densifyNewMrr(from, days, newMrrBuckets),
      },
    };
  }

  private computeTotals(input: {
    tenantsActive: number;
    tenantsPendingPurge: number;
    tenantsDeleted: number;
    userCount: number;
    statusHistogram: SubscriptionStatusSlice[];
    planDistribution: PlanDistributionRow[];
  }): PlatformAnalyticsTotals {
    const subscriptionsActive = input.statusHistogram
      .filter((s) => ACTIVE_STATUSES.includes(s.status))
      .reduce((acc, s) => acc + s.count, 0);
    const subscriptionsAtRisk = input.statusHistogram
      .filter((s) => AT_RISK_STATUSES.has(s.status))
      .reduce((acc, s) => acc + s.count, 0);
    const subscriptionsCanceled = input.statusHistogram
      .filter((s) => CANCELED_STATUSES.has(s.status))
      .reduce((acc, s) => acc + s.count, 0);

    const byCurrency = new Map<
      string,
      { mrr: number; subscribers: number }
    >();
    for (const row of input.planDistribution) {
      const cur = row.currency.toLowerCase();
      const slot = byCurrency.get(cur) ?? { mrr: 0, subscribers: 0 };
      slot.mrr += row.monthlyRevenue;
      slot.subscribers += row.subscribers;
      byCurrency.set(cur, slot);
    }
    const revenue: MrrByCurrency[] = Array.from(byCurrency.entries())
      .map(([currency, slot]) => ({
        currency,
        mrr: Number(slot.mrr.toFixed(2)),
        arr: Number((slot.mrr * 12).toFixed(2)),
        subscribers: slot.subscribers,
      }))
      .sort((a, b) => b.mrr - a.mrr);
    const dominantCurrency = revenue.length > 0 ? revenue[0].currency : null;

    return {
      tenantsActive: input.tenantsActive,
      tenantsPendingPurge: input.tenantsPendingPurge,
      tenantsDeleted: input.tenantsDeleted,
      userCount: input.userCount,
      subscriptionsActive,
      subscriptionsAtRisk,
      subscriptionsCanceled,
      revenue,
      dominantCurrency,
    };
  }

  /**
   * Fill missing days so the chart never shows gaps; cumulativeTenants seeded
   * with the count of tenants created before `from`.
   */
  private densifyTenantGrowth(
    from: Date,
    days: number,
    seedCumulative: number,
    rows: Array<{ date: string; newTenants: number }>,
  ): TenantGrowthBucket[] {
    const byDate = new Map(rows.map((r) => [r.date, r.newTenants]));
    const result: TenantGrowthBucket[] = [];
    let cumulative = seedCumulative;
    for (let i = 0; i < days; i++) {
      const day = new Date(from.getTime());
      day.setUTCDate(day.getUTCDate() + i);
      const key = day.toISOString().slice(0, 10);
      const newTenants = byDate.get(key) ?? 0;
      cumulative += newTenants;
      result.push({ date: key, newTenants, cumulativeTenants: cumulative });
    }
    return result;
  }

  private densifyNewMrr(
    from: Date,
    days: number,
    rows: Array<{ date: string; newSubscriptions: number; newMrr: number }>,
  ): NewMrrBucket[] {
    const byDate = new Map(rows.map((r) => [r.date, r] as const));
    const result: NewMrrBucket[] = [];
    for (let i = 0; i < days; i++) {
      const day = new Date(from.getTime());
      day.setUTCDate(day.getUTCDate() + i);
      const key = day.toISOString().slice(0, 10);
      const row = byDate.get(key);
      result.push({
        date: key,
        newMrr: row?.newMrr ?? 0,
        newSubscriptions: row?.newSubscriptions ?? 0,
      });
    }
    return result;
  }
}
