import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { isMongooseConnectionReady } from '../../common/mongoose/connection.util';
import {
  SubscriptionPlan,
  SubscriptionPlanDocument,
} from '../schemas/subscription-plan.schema';

export interface CreateSubscriptionPlanRecordInput {
  name: string;
  stripeProductId: string;
  stripePriceId: string;
  amount: number;
  currency: string;
  interval: string;
  trialDays: number;
  isTrialEnabled: boolean;
  features?: SubscriptionPlan['features'];
}

export interface UpdateSubscriptionPlanRecordInput {
  name?: string;
  amount?: number;
  currency?: string;
  interval?: string;
  trialDays?: number;
  isTrialEnabled?: boolean;
  features?: SubscriptionPlan['features'];
  archived?: boolean;
  stripePriceId?: string;
}

@Injectable()
export class SubscriptionPlanRepository {
  constructor(
    @InjectModel(SubscriptionPlan.name)
    private readonly model: Model<SubscriptionPlan>,
  ) {}

  isMongooseReady(): boolean {
    return isMongooseConnectionReady(this.model.db);
  }

  async create(
    input: CreateSubscriptionPlanRecordInput,
    session?: ClientSession,
  ): Promise<SubscriptionPlanDocument> {
    const doc = new this.model({
      ...input,
      archived: false,
    });
    if (session) {
      return doc.save({ session });
    }
    return doc.save();
  }

  async findById(id: string): Promise<SubscriptionPlanDocument | null> {
    if (!Types.ObjectId.isValid(id)) {
      return null;
    }
    return this.model.findById(new Types.ObjectId(id)).exec();
  }

  async findByStripePriceId(
    priceId: string,
  ): Promise<SubscriptionPlanDocument | null> {
    return this.model
      .findOne({ stripePriceId: priceId, archived: false })
      .exec();
  }

  async findByStripePriceIdIncludingArchived(
    priceId: string,
  ): Promise<SubscriptionPlanDocument | null> {
    return this.model.findOne({ stripePriceId: priceId }).exec();
  }

  async findMany(filters: {
    includeArchived: boolean;
  }): Promise<SubscriptionPlanDocument[]> {
    const q = this.model.find();
    if (!filters.includeArchived) {
      q.where({ archived: false });
    }
    return q.sort({ createdAt: -1 }).exec();
  }

  async updateById(
    id: string,
    patch: UpdateSubscriptionPlanRecordInput,
    session?: ClientSession,
  ): Promise<SubscriptionPlanDocument | null> {
    if (!Types.ObjectId.isValid(id)) {
      return null;
    }
    const q = this.model.findByIdAndUpdate(
      new Types.ObjectId(id),
      { $set: patch },
      { returnDocument: 'after' },
    );
    if (session) {
      q.session(session);
    }
    return q.exec();
  }
}
