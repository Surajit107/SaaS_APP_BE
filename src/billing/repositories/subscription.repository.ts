import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { isMongooseConnectionReady } from '../../common/mongoose/connection.util';
import {
  Subscription,
  SubscriptionDocument,
} from '../schemas/subscription.schema';

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

  async findManyPaginatedForPlatformAdmin(params: {
    skip: number;
    limit: number;
    status?: string;
    tenantId?: string;
  }): Promise<{ items: SubscriptionDocument[]; total: number }> {
    const filter: Record<string, string> = {};
    if (params.status !== undefined && params.status.length > 0) {
      filter.status = params.status;
    }
    if (params.tenantId !== undefined && params.tenantId.length > 0) {
      filter.tenantId = params.tenantId;
    }
    const [items, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ updatedAt: -1 })
        .skip(params.skip)
        .limit(params.limit)
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return { items, total };
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
