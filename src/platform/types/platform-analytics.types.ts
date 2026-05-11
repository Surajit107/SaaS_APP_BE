/**
 * Live analytics surfaces for the platform operator dashboard.
 *
 * Everything here is computed on-demand from primary collections
 * (`tenants`, `users`, `subscriptions`, `subscription_plans`) via aggregation —
 * there is no separate analytics store, no historical revenue ledger,
 * and no Stripe Invoice mirror.
 *
 * MRR / ARR numbers are derived from the active + trialing
 * subscriptions joined to the plan catalog and normalized to a monthly
 * amount per plan `interval` (`day | week | month | year`). They
 * approximate billable run-rate, not realized cash flow.
 */

export interface TenantGrowthBucket {
  /** UTC day (YYYY-MM-DD). */
  date: string;
  /** Tenants whose `createdAt` falls inside this day. */
  newTenants: number;
  /** Running total at end-of-day, including tenants created before the window. */
  cumulativeTenants: number;
}

export interface SubscriptionStatusSlice {
  status: string;
  count: number;
}

export interface PlanDistributionRow {
  /** `subscription_plans._id` hex, or null when the subscription points to an unknown plan (legacy / archived). */
  planId: string | null;
  /** Display name from catalog when joinable, else the raw subscription `planKey`. */
  planName: string;
  currency: string;
  /** Active + trialing subscribers attached to this plan. */
  subscribers: number;
  /** Monthly-normalized revenue contribution (currency = `currency`). */
  monthlyRevenue: number;
}

export interface MrrByCurrency {
  currency: string;
  mrr: number;
  arr: number;
  subscribers: number;
}

export interface NewMrrBucket {
  /** UTC day. */
  date: string;
  /** Sum of monthly-normalized MRR for subscriptions whose Mongo doc was first created in this bucket. Per-currency rolled up by `currency`. */
  newMrr: number;
  /** Subscriptions whose first document insertion happened in this bucket (any status). */
  newSubscriptions: number;
}

export interface PlatformAnalyticsTotals {
  tenantsActive: number;
  tenantsPendingPurge: number;
  tenantsDeleted: number;
  userCount: number;
  subscriptionsActive: number;
  subscriptionsAtRisk: number;
  subscriptionsCanceled: number;
  /** Per-currency MRR/ARR for active + trialing subs. Empty array when no live subscriptions. */
  revenue: MrrByCurrency[];
  /** Currency contributing the largest MRR. `null` when no live subs. */
  dominantCurrency: string | null;
}

export interface PlatformAnalyticsResponseData {
  range: {
    days: number;
    /** Inclusive ISO timestamp at start of window (UTC). */
    from: string;
    /** Inclusive ISO timestamp at end of window (UTC). */
    to: string;
  };
  totals: PlatformAnalyticsTotals;
  tenantGrowth: TenantGrowthBucket[];
  subscriptionStatus: SubscriptionStatusSlice[];
  planDistribution: PlanDistributionRow[];
  newMrrByDay: NewMrrBucket[];
}
