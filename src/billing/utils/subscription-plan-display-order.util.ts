/**
 * Canonical marketing / pricing table order (lowest tier first).
 * Names are matched case-insensitively; prefixes like "Pro Plus" still bucket under Pro.
 */
const DISPLAY_TIERS = ['free', 'starter', 'pro', 'enterprise'] as const;

function displayTierIndex(planName: string): number {
  const n = planName.trim().toLowerCase();
  for (let i = 0; i < DISPLAY_TIERS.length; i++) {
    const tier = DISPLAY_TIERS[i];
    if (n === tier || n.startsWith(`${tier} `) || n.startsWith(`${tier}-`)) {
      return i;
    }
  }
  return DISPLAY_TIERS.length;
}

/**
 * Sort plans for API responses: Free → Starter → Pro → Enterprise, then unknown names
 * (by amount asc, then name).
 */
export function sortSubscriptionPlansByDisplayOrder<
  T extends { name: string; amount?: number },
>(plans: readonly T[]): T[] {
  return [...plans].sort((a, b) => {
    const da = displayTierIndex(a.name);
    const db = displayTierIndex(b.name);
    if (da !== db) {
      return da - db;
    }
    const am = a.amount ?? 0;
    const bm = b.amount ?? 0;
    if (am !== bm) {
      return am - bm;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}
