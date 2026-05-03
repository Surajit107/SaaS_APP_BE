/** In-process domain events: Stripe webhook path → listeners (e.g. notifications). */
export const BillingSubscriptionEventName = {
  CheckoutCompleted: 'billing.subscription.checkout_completed',
  Updated: 'billing.subscription.updated',
  Ended: 'billing.subscription.ended',
  InvoicePaymentFailed: 'billing.subscription.invoice_payment_failed',
  InvoicePaid: 'billing.subscription.invoice_paid',
} as const;

export type BillingSubscriptionCheckoutCompletedPayload = {
  tenantId: string;
  stripeSubscriptionId: string;
  periodEndIso: string;
  planName: string | null;
};

export type BillingSubscriptionUpdatedPayload = {
  tenantId: string;
  stripeSubscriptionId: string;
  periodEndIso: string;
  cancelAtPeriodEnd: boolean;
};

export type BillingSubscriptionEndedPayload = {
  tenantId: string;
  stripeSubscriptionId: string;
};

export type BillingInvoiceNotificationPayload = {
  tenantId: string;
  invoiceId: string;
};
