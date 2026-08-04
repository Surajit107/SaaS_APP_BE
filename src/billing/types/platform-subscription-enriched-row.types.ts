/**
 * Subscription billing row joined with tenant fields for platform operator lists/detail.
 */
export type PlatformSubscriptionEnrichedRow = {
  tenantId: string;
  status: string;
  planKey: string;
  stripeCustomerId?: string;
  stripePriceId?: string;
  stripeSubscriptionId?: string;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  tenantName: string | null;
  tenantIsActive: boolean | null;
};
