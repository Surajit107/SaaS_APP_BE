import type { SubscriptionPlanDocument } from '../schemas/subscription-plan.schema';
import { isPlanNameAiChatbotTier } from './subscription-plan-ai-chatbot.util';

export type SubscriptionPlanFeatureLimitsResponse = {
  maxWorkspaces?: number;
  maxUsers?: number;
  maxFileAssets?: number;
  maxStorageMb?: number;
  aiChatbot?: boolean;
};

export type SubscriptionPlanEntitlementsResponse = {
  aiChatbot: boolean;
};

export type SubscriptionPlanResponse = {
  id: string;
  name: string;
  stripePriceId: string;
  amount: number;
  currency: string;
  interval: string;
  trialDays: number;
  isTrialEnabled: boolean;
  features: SubscriptionPlanFeatureLimitsResponse | null;
  entitlements: SubscriptionPlanEntitlementsResponse;
  featureHighlights: string[];
  createdAt: string;
  updatedAt: string;
  stripeProductId?: string;
  archived?: boolean;
};

type TimestampedSubscriptionPlanDocument = SubscriptionPlanDocument & {
  createdAt?: Date;
  updatedAt?: Date;
};

function toIsoString(value: Date | undefined): string {
  return value instanceof Date ? value.toISOString() : new Date(0).toISOString();
}

export function resolvePlanAiChatbotEntitlement(
  plan: Pick<SubscriptionPlanDocument, 'name' | 'features'>,
): boolean {
  const flag = plan.features?.aiChatbot;
  if (flag === true) {
    return true;
  }
  if (flag === false) {
    return false;
  }
  return isPlanNameAiChatbotTier(plan.name);
}

export function toPlanFeatureHighlights(
  features: SubscriptionPlanFeatureLimitsResponse | null,
  entitlements: SubscriptionPlanEntitlementsResponse,
): string[] {
  const highlights: string[] = [];
  if (typeof features?.maxWorkspaces === 'number') {
    highlights.push(`${features.maxWorkspaces} workspaces`);
  }
  if (typeof features?.maxUsers === 'number') {
    highlights.push(`${features.maxUsers} users`);
  }
  if (typeof features?.maxFileAssets === 'number') {
    highlights.push(`${features.maxFileAssets} file assets`);
  }
  if (typeof features?.maxStorageMb === 'number') {
    highlights.push(`${features.maxStorageMb} MB storage`);
  }
  if (entitlements.aiChatbot) {
    highlights.push('AI assistant');
  }
  return highlights;
}

export function serializeSubscriptionPlan(
  plan: SubscriptionPlanDocument,
  options: { includeAdminFields: boolean },
): SubscriptionPlanResponse {
  const features = plan.features
    ? {
        ...(typeof plan.features.maxWorkspaces === 'number'
          ? { maxWorkspaces: plan.features.maxWorkspaces }
          : {}),
        ...(typeof plan.features.maxUsers === 'number'
          ? { maxUsers: plan.features.maxUsers }
          : {}),
        ...(typeof plan.features.maxFileAssets === 'number'
          ? { maxFileAssets: plan.features.maxFileAssets }
          : {}),
        ...(typeof plan.features.maxStorageMb === 'number'
          ? { maxStorageMb: plan.features.maxStorageMb }
          : {}),
        ...(typeof plan.features.aiChatbot === 'boolean'
          ? { aiChatbot: plan.features.aiChatbot }
          : {}),
      }
    : null;
  const entitlements = {
    aiChatbot: resolvePlanAiChatbotEntitlement(plan),
  };
  const timestampedPlan = plan as TimestampedSubscriptionPlanDocument;
  const base: SubscriptionPlanResponse = {
    id: String(plan._id),
    name: plan.name,
    stripePriceId: plan.stripePriceId,
    amount: plan.amount,
    currency: plan.currency,
    interval: plan.interval,
    trialDays: plan.trialDays,
    isTrialEnabled: plan.isTrialEnabled,
    features,
    entitlements,
    featureHighlights: toPlanFeatureHighlights(features, entitlements),
    createdAt: toIsoString(timestampedPlan.createdAt),
    updatedAt: toIsoString(timestampedPlan.updatedAt),
  };

  if (!options.includeAdminFields) {
    return base;
  }

  return {
    ...base,
    stripeProductId: plan.stripeProductId,
    archived: plan.archived,
  };
}
