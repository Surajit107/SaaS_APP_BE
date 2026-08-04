import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type PipelineStage } from 'mongoose';
import { isMongooseConnectionReady } from '../../common/mongoose/connection.util';
import { escapeMongoRegexLiteral } from '../../common/utils/escape-mongo-regex-literal';
import {
  PLATFORM_SUBSCRIPTION_LIST_DEFAULT_SORT_BY,
  PLATFORM_SUBSCRIPTION_LIST_DEFAULT_SORT_ORDER,
  type PlatformSubscriptionListSortBy,
  type PlatformSubscriptionListSortOrder,
} from '../constants/platform-subscription-list.constants';
import {
  Subscription,
  SubscriptionDocument,
} from '../schemas/subscription.schema';
import type { PlatformSubscriptionEnrichedRow } from '../types/platform-subscription-enriched-row.types';

export interface UpsertTenantStripeSubscriptionInput {
  tenantId: string;
  planKey?: string;
  status: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripePriceId?: string;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd?: boolean;
}

@Injectable()
export class SubscriptionRepository {
  constructor(
    @InjectModel(Subscription.name) private readonly model: Model<Subscription>,
  ) {}

  isMongooseReady(): boolean {
    return isMongooseConnectionReady(this.model.db);
  }

  async findByTenantId(tenantId: string): Promise<SubscriptionDocument | null> {
    return this.model.findOne({ tenantId }).exec();
  }

  /**
   * Lightweight billing rows for a page of tenants (platform tenant list enrichment).
   */
  async findSummariesByTenantIds(
    tenantIds: string[],
  ): Promise<Map<string, { status: string; planKey: string }>> {
    if (tenantIds.length === 0) {
      return new Map();
    }
    const distinct = [...new Set(tenantIds)];
    const docs = await this.model
      .find({ tenantId: { $in: distinct } })
      .select('tenantId status planKey')
      .lean<Array<{ tenantId: string; status?: string; planKey?: string }>>()
      .exec();
    const out = new Map<string, { status: string; planKey: string }>();
    for (const doc of docs) {
      out.set(doc.tenantId, {
        status: typeof doc.status === 'string' ? doc.status : 'inactive',
        planKey: typeof doc.planKey === 'string' ? doc.planKey : '',
      });
    }
    return out;
  }

  async findByStripeCustomerId(
    customerId: string,
  ): Promise<SubscriptionDocument | null> {
    return this.model.findOne({ stripeCustomerId: customerId }).exec();
  }

  async findByStripeSubscriptionId(
    subscriptionId: string,
  ): Promise<SubscriptionDocument | null> {
    return this.model.findOne({ stripeSubscriptionId: subscriptionId }).exec();
  }

  async upsertForTenant(
    input: UpsertTenantStripeSubscriptionInput,
  ): Promise<SubscriptionDocument> {
    const filter = { tenantId: input.tenantId };
    const update: Record<string, unknown> = {
      tenantId: input.tenantId,
      status: input.status,
    };
    if (input.planKey !== undefined) {
      update.planKey = input.planKey;
    }
    if (input.stripeCustomerId !== undefined) {
      update.stripeCustomerId = input.stripeCustomerId;
    }
    if (input.stripeSubscriptionId !== undefined) {
      update.stripeSubscriptionId = input.stripeSubscriptionId;
    }
    if (input.stripePriceId !== undefined) {
      update.stripePriceId = input.stripePriceId;
    }
    if (input.currentPeriodStart !== undefined) {
      update.currentPeriodStart = input.currentPeriodStart;
    }
    if (input.currentPeriodEnd !== undefined) {
      update.currentPeriodEnd = input.currentPeriodEnd;
    }
    if (input.cancelAtPeriodEnd !== undefined) {
      update.cancelAtPeriodEnd = input.cancelAtPeriodEnd;
    }

    const doc = await this.model
      .findOneAndUpdate(
        filter,
        { $set: update },
        { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true },
      )
      .exec();

    if (!doc) {
      throw new Error('Failed to upsert subscription');
    }
    return doc;
  }

  async setStripeCustomerId(
    tenantId: string,
    stripeCustomerId: string,
  ): Promise<SubscriptionDocument | null> {
    return this.model
      .findOneAndUpdate(
        { tenantId },
        { $set: { stripeCustomerId } },
        { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true },
      )
      .exec();
  }

  /**
   * Paginated billing rows for platform operators, joined with tenant name/active.
   * Search filters on tenant name or subscription tenantId (case-insensitive substring).
   * Index note: `{ status: 1, updatedAt: -1 }` covers status + updatedAt sort; name search
   * uses regex after `$lookup` (same approach as platform tenant list — no text index yet).
   */
  async findManyPaginatedForPlatformAdmin(params: {
    skip: number;
    limit: number;
    status?: string;
    tenantId?: string;
    search?: string;
    sortBy?: PlatformSubscriptionListSortBy;
    sortOrder?: PlatformSubscriptionListSortOrder;
  }): Promise<{ items: PlatformSubscriptionEnrichedRow[]; total: number }> {
    const match: Record<string, string> = {};
    if (params.status !== undefined && params.status.length > 0) {
      match.status = params.status;
    }
    if (params.tenantId !== undefined && params.tenantId.length > 0) {
      match.tenantId = params.tenantId;
    }

    const sortBy =
      params.sortBy ?? PLATFORM_SUBSCRIPTION_LIST_DEFAULT_SORT_BY;
    const sortOrder =
      params.sortOrder ?? PLATFORM_SUBSCRIPTION_LIST_DEFAULT_SORT_ORDER;
    const direction: 1 | -1 = sortOrder === 'asc' ? 1 : -1;
    const sortStage = this.buildPlatformAdminSortStage(sortBy, direction);

    const pipeline: PipelineStage[] = [];
    if (Object.keys(match).length > 0) {
      pipeline.push({ $match: match });
    }
    pipeline.push(
      {
        $lookup: {
          from: 'tenants',
          localField: 'tenantId',
          foreignField: 'tenantId',
          as: 'tenant',
        },
      },
      { $unwind: { path: '$tenant', preserveNullAndEmptyArrays: true } },
    );

    if (params.search !== undefined && params.search.length > 0) {
      const safe = escapeMongoRegexLiteral(params.search);
      pipeline.push({
        $match: {
          $or: [
            { 'tenant.name': { $regex: safe, $options: 'i' } },
            { tenantId: { $regex: safe, $options: 'i' } },
          ],
        },
      });
    }

    pipeline.push({
      $facet: {
        items: [
          { $sort: sortStage },
          { $skip: params.skip },
          { $limit: params.limit },
          {
            $project: {
              _id: 0,
              tenantId: 1,
              status: 1,
              planKey: 1,
              stripeCustomerId: 1,
              stripePriceId: 1,
              stripeSubscriptionId: 1,
              currentPeriodStart: 1,
              currentPeriodEnd: 1,
              cancelAtPeriodEnd: 1,
              createdAt: 1,
              updatedAt: 1,
              tenantName: { $ifNull: ['$tenant.name', null] },
              tenantIsActive: { $ifNull: ['$tenant.isActive', null] },
            },
          },
        ],
        total: [{ $count: 'count' }],
      },
    });

    type FacetResult = {
      items: PlatformSubscriptionEnrichedRow[];
      total: Array<{ count: number }>;
    };
    const [facet] = await this.model.aggregate<FacetResult>(pipeline).exec();
    const total =
      facet?.total?.[0]?.count !== undefined ? facet.total[0].count : 0;
    const items = facet?.items ?? [];
    return { items, total };
  }

  async findByTenantIdEnrichedForPlatformAdmin(
    tenantId: string,
  ): Promise<PlatformSubscriptionEnrichedRow | null> {
    type Row = PlatformSubscriptionEnrichedRow;
    const rows = await this.model
      .aggregate<Row>([
        { $match: { tenantId } },
        {
          $lookup: {
            from: 'tenants',
            localField: 'tenantId',
            foreignField: 'tenantId',
            as: 'tenant',
          },
        },
        { $unwind: { path: '$tenant', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 0,
            tenantId: 1,
            status: 1,
            planKey: 1,
            stripeCustomerId: 1,
            stripePriceId: 1,
            stripeSubscriptionId: 1,
            currentPeriodStart: 1,
            currentPeriodEnd: 1,
            cancelAtPeriodEnd: 1,
            createdAt: 1,
            updatedAt: 1,
            tenantName: { $ifNull: ['$tenant.name', null] },
            tenantIsActive: { $ifNull: ['$tenant.isActive', null] },
          },
        },
        { $limit: 1 },
      ])
      .exec();
    return rows[0] ?? null;
  }

  private buildPlatformAdminSortStage(
    sortBy: PlatformSubscriptionListSortBy,
    direction: 1 | -1,
  ): Record<string, 1 | -1> {
    switch (sortBy) {
      case 'tenantName':
        return { 'tenant.name': direction, updatedAt: -1 };
      case 'status':
        return { status: direction, updatedAt: -1 };
      case 'planKey':
        return { planKey: direction, updatedAt: -1 };
      case 'createdAt':
        return { createdAt: direction };
      case 'updatedAt':
      default:
        return { updatedAt: direction };
    }
  }

  /** Status histogram across all subscription rows (cross-tenant, platform operator only). */
  async aggregateStatusHistogramForPlatformAdmin(): Promise<
    Array<{ status: string; count: number }>
  > {
    type Row = { _id: string; count: number };
    const rows = await this.model
      .aggregate<Row>([
        {
          $group: {
            _id: { $ifNull: ['$status', 'unknown'] },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
      ])
      .exec();
    return rows.map((r) => ({ status: r._id, count: r.count }));
  }

  /**
   * Plan distribution + per-plan revenue contribution for active + trialing subs.
   * Joins to `subscription_plans` on `stripePriceId` (reliable) and falls back to
   * matching the raw `planKey` against the plan `name` for legacy rows. Revenue is
   * normalized to a monthly figure per plan `interval`.
   */
  async aggregatePlanDistributionForPlatformAdmin(
    activeStatuses: readonly string[],
  ): Promise<
    Array<{
      planId: string | null;
      planName: string;
      currency: string;
      subscribers: number;
      monthlyRevenue: number;
    }>
  > {
    type AggregatedPlanDistributionRow = {
      _id: { planId: string | null; planName: string; currency: string };
      subscribers: number;
      monthlyRevenue: number;
    };
    const monthlyAmountExpr = {
      $switch: {
        branches: [
          { case: { $eq: ['$plan.interval', 'day'] }, then: { $multiply: ['$plan.amount', 30] } },
          {
            case: { $eq: ['$plan.interval', 'week'] },
            then: { $multiply: ['$plan.amount', 4.345] },
          },
          {
            case: { $eq: ['$plan.interval', 'month'] },
            then: '$plan.amount',
          },
          {
            case: { $eq: ['$plan.interval', 'year'] },
            then: { $divide: ['$plan.amount', 12] },
          },
        ],
        default: 0,
      },
    };
    const rows = await this.model
      .aggregate<AggregatedPlanDistributionRow>([
        { $match: { status: { $in: [...activeStatuses] } } },
        {
          $lookup: {
            from: 'subscription_plans',
            let: { priceId: '$stripePriceId', planKey: '$planKey' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $or: [
                      {
                        $and: [
                          { $ne: ['$$priceId', null] },
                          { $eq: ['$stripePriceId', '$$priceId'] },
                        ],
                      },
                      {
                        $and: [
                          { $ne: ['$$planKey', ''] },
                          { $ne: ['$$planKey', null] },
                          { $eq: ['$name', '$$planKey'] },
                        ],
                      },
                    ],
                  },
                },
              },
              { $limit: 1 },
            ],
            as: 'plan',
          },
        },
        { $unwind: { path: '$plan', preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: {
              planId: { $toString: { $ifNull: ['$plan._id', null] } },
              planName: {
                $ifNull: [
                  '$plan.name',
                  { $ifNull: ['$planKey', 'Unknown plan'] },
                ],
              },
              currency: {
                $toLower: { $ifNull: ['$plan.currency', 'usd'] },
              },
            },
            subscribers: { $sum: 1 },
            monthlyRevenue: {
              $sum: {
                $cond: [{ $ifNull: ['$plan', false] }, monthlyAmountExpr, 0],
              },
            },
          },
        },
        { $sort: { monthlyRevenue: -1, subscribers: -1 } },
      ])
      .exec();
    return rows.map((r) => ({
      planId: r._id.planId !== '' && r._id.planId !== null ? r._id.planId : null,
      planName:
        typeof r._id.planName === 'string' && r._id.planName.length > 0
          ? r._id.planName
          : 'Unknown plan',
      currency:
        typeof r._id.currency === 'string' && r._id.currency.length > 0
          ? r._id.currency
          : 'usd',
      subscribers: r.subscribers,
      monthlyRevenue: Number((r.monthlyRevenue || 0).toFixed(2)),
    }));
  }

  /**
   * Daily buckets of newly created subscription rows (any status) since `from`,
   * with their plan-derived monthly amount. Used for the "new MRR added" timeline.
   */
  async aggregateDailyNewMrrForPlatformAdmin(
    from: Date,
  ): Promise<
    Array<{ date: string; newSubscriptions: number; newMrr: number }>
  > {
    type Row = { _id: string; newSubscriptions: number; newMrr: number };
    const monthlyAmountExpr = {
      $switch: {
        branches: [
          { case: { $eq: ['$plan.interval', 'day'] }, then: { $multiply: ['$plan.amount', 30] } },
          {
            case: { $eq: ['$plan.interval', 'week'] },
            then: { $multiply: ['$plan.amount', 4.345] },
          },
          {
            case: { $eq: ['$plan.interval', 'month'] },
            then: '$plan.amount',
          },
          {
            case: { $eq: ['$plan.interval', 'year'] },
            then: { $divide: ['$plan.amount', 12] },
          },
        ],
        default: 0,
      },
    };
    const rows = await this.model
      .aggregate<Row>([
        { $match: { createdAt: { $gte: from } } },
        {
          $lookup: {
            from: 'subscription_plans',
            let: { priceId: '$stripePriceId', planKey: '$planKey' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $or: [
                      {
                        $and: [
                          { $ne: ['$$priceId', null] },
                          { $eq: ['$stripePriceId', '$$priceId'] },
                        ],
                      },
                      {
                        $and: [
                          { $ne: ['$$planKey', ''] },
                          { $ne: ['$$planKey', null] },
                          { $eq: ['$name', '$$planKey'] },
                        ],
                      },
                    ],
                  },
                },
              },
              { $limit: 1 },
            ],
            as: 'plan',
          },
        },
        { $unwind: { path: '$plan', preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$createdAt',
                timezone: 'UTC',
              },
            },
            newSubscriptions: { $sum: 1 },
            newMrr: {
              $sum: {
                $cond: [{ $ifNull: ['$plan', false] }, monthlyAmountExpr, 0],
              },
            },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .exec();
    return rows.map((r) => ({
      date: r._id,
      newSubscriptions: r.newSubscriptions,
      newMrr: Number((r.newMrr || 0).toFixed(2)),
    }));
  }

  async markCanceledByTenant(
    tenantId: string,
    stripeCustomerId: string,
    periodEnd?: Date,
  ): Promise<void> {
    await this.model
      .updateOne(
        { tenantId },
        {
          $set: {
            status: 'canceled',
            stripeCustomerId,
            cancelAtPeriodEnd: false,
            ...(periodEnd ? { currentPeriodEnd: periodEnd } : {}),
          },
          $unset: { stripeSubscriptionId: 1, stripePriceId: 1 },
        },
      )
      .exec();
  }
}
