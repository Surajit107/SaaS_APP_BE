import { BadRequestException, Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import type { ApiSuccessResponse } from '../../common/types/api-response.types';
import { PlatformSubscriptionListQueryDto } from '../dto/platform-subscription-list-query.dto';
import { SubscriptionRepository } from '../repositories/subscription.repository';
import type { SubscriptionDocument } from '../schemas/subscription.schema';
import type { PlatformSubscriptionSnapshot } from '../types/platform-subscription-snapshot.types';

@Injectable()
export class PlatformSubscriptionMonitoringService {
  constructor(private readonly subscriptions: SubscriptionRepository) {}

  async list(query: PlatformSubscriptionListQueryDto): Promise<
    ApiSuccessResponse<{
      items: PlatformSubscriptionSnapshot[];
      total: number;
      page: number;
      limit: number;
    }>
  > {
    if (
      query.tenantId !== undefined &&
      !Types.ObjectId.isValid(query.tenantId)
    ) {
      throw new BadRequestException('Invalid tenant id');
    }
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const { items, total } =
      await this.subscriptions.findManyPaginatedForPlatformAdmin({
        skip,
        limit,
        status: query.status,
        tenantId: query.tenantId,
      });
    return {
      success: true,
      message: 'OK',
      data: {
        items: items.map((d) => this.toSnapshot(d)),
        total,
        page,
        limit,
      },
    };
  }

  async getByTenantId(
    tenantId: string,
  ): Promise<ApiSuccessResponse<PlatformSubscriptionSnapshot>> {
    if (!Types.ObjectId.isValid(tenantId)) {
      throw new BadRequestException('Invalid tenant id');
    }
    const doc = await this.subscriptions.findByTenantId(tenantId);
    if (!doc) {
      return {
        success: true,
        message: 'No billing record for tenant yet',
        data: {
          tenantId,
          status: 'inactive',
          planKey: '',
          cancelAtPeriodEnd: false,
        },
      };
    }
    return {
      success: true,
      message: 'OK',
      data: this.toSnapshot(doc),
    };
  }

  private toSnapshot(doc: SubscriptionDocument): PlatformSubscriptionSnapshot {
    return {
      tenantId: doc.tenantId,
      status: doc.status,
      planKey: doc.planKey,
      stripeCustomerId: doc.stripeCustomerId,
      stripePriceId: doc.stripePriceId,
      stripeSubscriptionId: doc.stripeSubscriptionId,
      currentPeriodStart: doc.currentPeriodStart?.toISOString(),
      currentPeriodEnd: doc.currentPeriodEnd?.toISOString(),
      cancelAtPeriodEnd: doc.cancelAtPeriodEnd ?? false,
      createdAt: doc.createdAt?.toISOString(),
      updatedAt: doc.updatedAt?.toISOString(),
    };
  }
}
