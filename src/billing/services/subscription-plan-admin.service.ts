import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ApiSuccessResponse } from '../../common/types/api-response.types';
import { SubscriptionPlanRepository } from '../repositories/subscription-plan.repository';
import { StripeClientService } from './stripe-client.service';
import { CreateSubscriptionPlanDto } from '../dto/create-subscription-plan.dto';
import { UpdateSubscriptionPlanDto } from '../dto/update-subscription-plan.dto';
import { sortSubscriptionPlansByDisplayOrder } from '../utils/subscription-plan-display-order.util';
import { isPlanNameAiChatbotTier } from '../utils/subscription-plan-ai-chatbot.util';
import {
  serializeSubscriptionPlan,
  type SubscriptionPlanResponse,
} from '../utils/subscription-plan-response.util';

@Injectable()
export class SubscriptionPlanAdminService {
  constructor(
    private readonly plans: SubscriptionPlanRepository,
    private readonly stripeClient: StripeClientService,
  ) {}

  private majorUnitsToStripeAmount(amount: number, currency: string): number {
    const c = currency.toLowerCase();
    const zeroDecimal = [
      'jpy',
      'krw',
      'vnd',
      'clp',
      'ugx',
      'xaf',
      'xof',
      'xpf',
    ];
    if (zeroDecimal.includes(c)) {
      return Math.round(amount);
    }
    return Math.round(amount * 100);
  }

  async create(
    dto: CreateSubscriptionPlanDto,
  ): Promise<ApiSuccessResponse<SubscriptionPlanResponse>> {
    if (
      dto.features?.aiChatbot === true &&
      !isPlanNameAiChatbotTier(dto.name)
    ) {
      throw new BadRequestException(
        'AI assistant catalog override is only allowed for Pro or Enterprise plan names.',
      );
    }

    const currency = (dto.currency ?? 'usd').toLowerCase();
    const stripe = this.stripeClient.getStripe();

    const product = await stripe.products.create({
      name: dto.name,
      metadata: { managedBy: 'saas_backend' },
    });

    const price = await stripe.prices.create({
      unit_amount: this.majorUnitsToStripeAmount(dto.amount, currency),
      currency,
      recurring: {
        interval: dto.interval,
      },
      product: product.id,
    });

    const doc = await this.plans.create({
      name: dto.name,
      stripeProductId: product.id,
      stripePriceId: price.id,
      amount: dto.amount,
      currency,
      interval: dto.interval,
      trialDays: dto.trialDays ?? 0,
      isTrialEnabled: dto.isTrialEnabled ?? false,
      features: dto.features,
    });

    return {
      success: true,
      message: 'Subscription plan created',
      data: serializeSubscriptionPlan(doc, { includeAdminFields: true }),
    };
  }

  async list(
    includeArchived: boolean,
    viewerIsPlatformAdmin: boolean,
  ): Promise<
    ApiSuccessResponse<SubscriptionPlanResponse[]>
  > {
    const effectiveIncludeArchived =
      viewerIsPlatformAdmin && includeArchived === true;
    const rows = sortSubscriptionPlansByDisplayOrder(
      await this.plans.findMany({
        includeArchived: effectiveIncludeArchived,
      }),
    );

    return {
      success: true,
      message: 'OK',
      data: rows.map((p) =>
        serializeSubscriptionPlan(p, {
          includeAdminFields: viewerIsPlatformAdmin,
        }),
      ),
    };
  }

  async getById(
    id: string,
    viewerIsPlatformAdmin: boolean,
  ): Promise<
    ApiSuccessResponse<SubscriptionPlanResponse>
  > {
    const p = await this.plans.findById(id);
    if (!p) {
      throw new NotFoundException('Subscription plan not found');
    }
    if (!viewerIsPlatformAdmin && p.archived) {
      throw new NotFoundException('Subscription plan not found');
    }
    return {
      success: true,
      message: 'OK',
      data: serializeSubscriptionPlan(p, {
        includeAdminFields: viewerIsPlatformAdmin,
      }),
    };
  }

  async update(
    id: string,
    dto: UpdateSubscriptionPlanDto,
  ): Promise<
    ApiSuccessResponse<SubscriptionPlanResponse>
  > {
    if (dto.archived !== undefined) {
      throw new BadRequestException(
        'Archiving is only supported via DELETE /platform/subscription-plans/:id',
      );
    }
    const existing = await this.plans.findById(id);
    if (!existing) {
      throw new NotFoundException('Subscription plan not found');
    }
    if (existing.archived) {
      throw new ConflictException('Archived plans cannot be updated');
    }

    const pricingChanged =
      dto.amount !== undefined ||
      dto.currency !== undefined ||
      dto.interval !== undefined;
    if (pricingChanged) {
      throw new BadRequestException(
        'Price and billing interval are immutable for existing plans. Create a new plan version via POST /platform/subscription-plans.',
      );
    }

    const effectivePlanName =
      dto.name !== undefined ? dto.name : existing.name;
    if (
      dto.features?.aiChatbot === true &&
      !isPlanNameAiChatbotTier(effectivePlanName)
    ) {
      throw new BadRequestException(
        'AI assistant catalog override is only allowed for Pro or Enterprise plan names.',
      );
    }

    const stripe = this.stripeClient.getStripe();

    if (dto.name !== undefined) {
      await stripe.products.update(existing.stripeProductId, {
        name: dto.name,
      });
    }

    const updated = await this.plans.updateById(id, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.trialDays !== undefined ? { trialDays: dto.trialDays } : {}),
      ...(dto.isTrialEnabled !== undefined
        ? { isTrialEnabled: dto.isTrialEnabled }
        : {}),
      ...(dto.features !== undefined ? { features: dto.features } : {}),
    });

    if (!updated) {
      throw new NotFoundException('Subscription plan not found');
    }

    return {
      success: true,
      message: 'Subscription plan updated',
      data: serializeSubscriptionPlan(updated, { includeAdminFields: true }),
    };
  }

  async archive(id: string): Promise<ApiSuccessResponse<SubscriptionPlanResponse>> {
    const existing = await this.plans.findById(id);
    if (!existing) {
      throw new NotFoundException('Subscription plan not found');
    }
    if (existing.archived) {
      throw new BadRequestException('Plan is already archived');
    }

    const stripe = this.stripeClient.getStripe();
    await stripe.prices.update(existing.stripePriceId, { active: false });
    await stripe.products.update(existing.stripeProductId, { active: false });

    const updated = await this.plans.updateById(id, { archived: true });
    if (!updated) {
      throw new NotFoundException('Subscription plan not found');
    }

    return {
      success: true,
      message:
        'Subscription plan archived in Stripe and deactivated in catalog',
      data: serializeSubscriptionPlan(updated, { includeAdminFields: true }),
    };
  }
}
