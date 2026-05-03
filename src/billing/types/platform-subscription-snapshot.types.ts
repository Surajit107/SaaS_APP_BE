/** Persisted billing row exposed to platform operators (cross-tenant reads). */
export type PlatformSubscriptionSnapshot = {
  tenantId: string;
  status: string;
  planKey: string;
  stripeCustomerId?: string;
  stripePriceId?: string;
  stripeSubscriptionId?: string;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd: boolean;
  createdAt?: string;
  updatedAt?: string;
};
