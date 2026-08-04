import { BadRequestException, Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import type { ApiSuccessResponse } from '../../common/types/api-response.types';
import {
  PLATFORM_SUBSCRIPTION_LIST_DEFAULT_SORT_BY,
  PLATFORM_SUBSCRIPTION_LIST_DEFAULT_SORT_ORDER,
} from '../constants/platform-subscription-list.constants';
import { PlatformSubscriptionListQueryDto } from '../dto/platform-subscription-list-query.dto';
import { SubscriptionRepository } from '../repositories/subscription.repository';
import type { PlatformSubscriptionEnrichedRow } from '../types/platform-subscription-enriched-row.types';
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
        search: query.search,
        sortBy: query.sortBy ?? PLATFORM_SUBSCRIPTION_LIST_DEFAULT_SORT_BY,
        sortOrder:
          query.sortOrder ?? PLATFORM_SUBSCRIPTION_LIST_DEFAULT_SORT_ORDER,
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
    const doc =
      await this.subscriptions.findByTenantIdEnrichedForPlatformAdmin(tenantId);
    if (!doc) {
      return {
        success: true,
        message: 'No billing record for tenant yet',
        data: {
          tenantId,
          tenantName: null,
          tenantIsActive: null,
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

  private toSnapshot(
    doc: PlatformSubscriptionEnrichedRow,
  ): PlatformSubscriptionSnapshot {
    return {
      tenantId: doc.tenantId,
      tenantName: doc.tenantName,
      tenantIsActive: doc.tenantIsActive,
      status: doc.status,
      planKey: doc.planKey,
      stripeCustomerId: doc.stripeCustomerId,
      stripePriceId: doc.stripePriceId,
      stripeSubscriptionId: doc.stripeSubscriptionId,
      currentPeriodStart: doc.currentPeriodStart
        ? new Date(doc.currentPeriodStart).toISOString()
        : undefined,
      currentPeriodEnd: doc.currentPeriodEnd
        ? new Date(doc.currentPeriodEnd).toISOString()
        : undefined,
      cancelAtPeriodEnd: doc.cancelAtPeriodEnd ?? false,
      createdAt: doc.createdAt
        ? new Date(doc.createdAt).toISOString()
        : undefined,
      updatedAt: doc.updatedAt
        ? new Date(doc.updatedAt).toISOString()
        : undefined,
    };
  }
}
