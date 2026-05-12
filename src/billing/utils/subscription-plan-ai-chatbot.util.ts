/**
 * Tier names that include the premium AI assistant (Pro & Enterprise marketing tiers).
 * Matches the prefix rules used for pricing table ordering — see `subscription-plan-display-order.util.ts`.
 */
const AI_ELIGIBLE_TIERS = ['pro', 'enterprise'] as const;

function matchesTierPrefix(planName: string, tier: (typeof AI_ELIGIBLE_TIERS)[number]): boolean {
  const n = planName.trim().toLowerCase();
  return n === tier || n.startsWith(`${tier} `) || n.startsWith(`${tier}-`);
}

/**
 * Returns true when the catalog plan name (or legacy `planKey`) is a Pro or Enterprise tier.
 * Does not inspect `features.aiChatbot` — that is handled in `SubscriptionEntitlementsService`.
 */
export function isPlanNameAiChatbotTier(planName: string): boolean {
  if (planName.trim().length === 0) {
    return false;
  }
  return AI_ELIGIBLE_TIERS.some((tier) => matchesTierPrefix(planName, tier));
}
