import { ForbiddenException, Injectable } from '@nestjs/common';
import { SubscriptionPlanRepository } from '../repositories/subscription-plan.repository';
import { SubscriptionRepository } from '../repositories/subscription.repository';
import { isPlanNameAiChatbotTier } from '../utils/subscription-plan-ai-chatbot.util';

/**
 * Resolved feature caps for a tenant's current subscription.
 * `null` on a dimension means the plan defines no cap (unlimited).
 */
export type FeatureLimits = {
  maxWorkspaces: number | null;
  maxUsers: number | null;
  maxFileAssets: number | null;
  maxStorageMb: number | null;
};

const ACTIVE_STATUSES = new Set(['active', 'trialing']);

/**
 * Safe floor applied when a tenant has no active/trialing subscription.
 * Deliberately mirrors the Free plan so new registrations are not hard-blocked
 * before the tenant picks a paid plan.
 */
const FALLBACK_FREE_LIMITS: Readonly<FeatureLimits> = {
  maxWorkspaces: 1,
  maxUsers: 3,
  maxFileAssets: 50,
  maxStorageMb: 500,
};

/**
 * Single source of truth for subscription-driven feature enforcement.
 *
 * Domain services inject this and call `assert*` methods at write-time.
 * Enforcement never lives in controllers or guards — it lives here, called
 * from the service layer, consistent with the existing architecture.
 */
@Injectable()
export class SubscriptionEntitlementsService {
  constructor(
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly planRepository: SubscriptionPlanRepository,
  ) {}

  /**
   * Resolves the effective feature limits for a tenant.
   *
   * Resolution order:
   *   1. Active/trialing subscription with a valid `stripePriceId` → plan features.
   *   2. Plan document missing or has no `features` subdocument → Free-plan floor.
   *   3. No subscription record, or status is inactive/canceled → Free-plan floor.
   *
   * A `null` value on any dimension means that plan imposes no cap on that resource.
   */
  async resolveFeatureLimits(tenantId: string): Promise<FeatureLimits> {
    const subscription = await this.subscriptionRepository.findByTenantId(tenantId);

    const hasActiveSubscription =
      subscription !== null &&
      ACTIVE_STATUSES.has(subscription.status) &&
      typeof subscription.stripePriceId === 'string' &&
      subscription.stripePriceId.length > 0;

    if (!hasActiveSubscription) {
      return { ...FALLBACK_FREE_LIMITS };
    }

    // Non-null asserted: stripePriceId verified above.
    const plan = await this.planRepository.findByStripePriceIdIncludingArchived(
      subscription.stripePriceId as string,
    );

    if (!plan?.features) {
      return { ...FALLBACK_FREE_LIMITS };
    }

    return {
      maxWorkspaces: plan.features.maxWorkspaces ?? null,
      maxUsers: plan.features.maxUsers ?? null,
      maxFileAssets: plan.features.maxFileAssets ?? null,
      maxStorageMb: plan.features.maxStorageMb ?? null,
    };
  }

  /**
   * Throws `ForbiddenException` if inviting one more user would exceed the plan's user cap.
   *
   * @param currentCount - Count of existing users for the tenant (before the invite).
   *   Pass `UserRepository.countByTenantId(tenantId)` — it excludes platform admins.
   */
  async assertWithinUserLimit(tenantId: string, currentCount: number): Promise<void> {
    const { maxUsers } = await this.resolveFeatureLimits(tenantId);
    if (maxUsers !== null && currentCount >= maxUsers) {
      throw new ForbiddenException(
        `Your plan allows a maximum of ${maxUsers} ${maxUsers === 1 ? 'user' : 'users'}. ` +
          'Upgrade your subscription to invite more members.',
      );
    }
  }

  /**
   * Throws `ForbiddenException` if uploading one more file would exceed the plan's file-asset cap.
   *
   * @param currentCount - Count of FINALIZED file assets for the tenant (temp assets excluded).
   */
  async assertWithinFileAssetLimit(tenantId: string, currentCount: number): Promise<void> {
    const { maxFileAssets } = await this.resolveFeatureLimits(tenantId);
    if (maxFileAssets !== null && currentCount >= maxFileAssets) {
      throw new ForbiddenException(
        `Your plan allows a maximum of ${maxFileAssets} ${maxFileAssets === 1 ? 'file asset' : 'file assets'}. ` +
          'Upgrade your subscription to upload more files.',
      );
    }
  }

  /**
   * Throws `ForbiddenException` if storing a new file would exceed the plan's storage quota.
   *
   * @param currentBytes - Sum of `bytes` for all FINALIZED assets already stored.
   * @param incomingBytes - Byte size of the file about to be registered (0 if unknown).
   */
  async assertWithinStorageLimit(
    tenantId: string,
    currentBytes: number,
    incomingBytes: number,
  ): Promise<void> {
    const { maxStorageMb } = await this.resolveFeatureLimits(tenantId);
    if (maxStorageMb !== null) {
      const maxBytes = maxStorageMb * 1024 * 1024;
      if (currentBytes + incomingBytes > maxBytes) {
        const usedMb = Math.round((currentBytes / (1024 * 1024)) * 100) / 100;
        throw new ForbiddenException(
          `Storage quota of ${maxStorageMb} MB exceeded (currently using ~${usedMb} MB). ` +
            'Upgrade your subscription to store more data.',
        );
      }
    }
  }

  /**
   * Throws `ForbiddenException` if creating one more workspace would exceed the plan's workspace cap.
   *
   * @param currentCount - Count of existing workspaces for the tenant.
   */
  async assertWithinWorkspaceLimit(tenantId: string, currentCount: number): Promise<void> {
    const { maxWorkspaces } = await this.resolveFeatureLimits(tenantId);
    if (maxWorkspaces !== null && currentCount >= maxWorkspaces) {
      throw new ForbiddenException(
        `Your plan allows a maximum of ${maxWorkspaces} ${maxWorkspaces === 1 ? 'workspace' : 'workspaces'}. ` +
          'Upgrade your subscription to create more workspaces.',
      );
    }
  }

  /**
   * Whether the tenant may use the AI assistant.
   *
   * Resolution: load the catalog plan by `subscription.stripePriceId`. If a row exists, only that
   * row decides access (`features.aiChatbot` overrides Pro/Enterprise name defaults). If no row is
   * found, fall back to `subscription.planKey` matching Pro/Enterprise tier names (legacy /
   * migration path).
   */
  async resolveAiChatbotAccess(tenantId: string): Promise<boolean> {
    const subscription = await this.subscriptionRepository.findByTenantId(tenantId);

    const hasActiveSubscription =
      subscription !== null &&
      ACTIVE_STATUSES.has(subscription.status) &&
      typeof subscription.stripePriceId === 'string' &&
      subscription.stripePriceId.length > 0;

    if (!hasActiveSubscription) {
      return false;
    }

    const plan = await this.planRepository.findByStripePriceIdIncludingArchived(
      subscription.stripePriceId as string,
    );

    if (plan) {
      const flag = plan.features?.aiChatbot;
      if (flag === false) {
        return false;
      }
      if (flag === true) {
        return true;
      }
      if (isPlanNameAiChatbotTier(plan.name)) {
        return true;
      }
      // Catalog row exists but does not grant AI (e.g. custom tier name, no override). Do not fall
      // back to `subscription.planKey` — that mirror can lag or disagree and would override an
      // explicit catalog decision such as `features.aiChatbot: false` on Pro/Enterprise.
      return false;
    }

    const planKey = typeof subscription.planKey === 'string' ? subscription.planKey : '';
    if (planKey.length > 0 && isPlanNameAiChatbotTier(planKey)) {
      return true;
    }

    return false;
  }

  /**
   * Throws `ForbiddenException` when the tenant subscription does not include AI assistant access.
   */
  async assertTenantHasAiChatbotAccess(tenantId: string): Promise<void> {
    const allowed = await this.resolveAiChatbotAccess(tenantId);
    if (!allowed) {
      throw new ForbiddenException(
        'The AI assistant is included with Pro and Enterprise. Upgrade your subscription to unlock contextual help for your workspace.',
      );
    }
  }
}
