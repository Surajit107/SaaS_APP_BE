import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { isMongooseConnectionReady } from '../../common/mongoose/connection.util';
import {
  Notification,
  NotificationDocument,
} from '../schemas/notification.schema';

export interface CreateTenantNotificationInput {
  tenantId: string;
  /** When set, list endpoint returns this row only to that user (and tenant admins). */
  recipientUserId?: string;
  channel?: string;
  type: string;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class NotificationRepository {
  constructor(
    @InjectModel(Notification.name) private readonly model: Model<Notification>,
  ) {}

  isMongooseReady(): boolean {
    return isMongooseConnectionReady(this.model.db);
  }

  async createInApp(
    input: CreateTenantNotificationInput,
  ): Promise<NotificationDocument> {
    return this.model.create({
      tenantId: input.tenantId,
      recipientUserId: input.recipientUserId,
      channel: input.channel ?? 'in_app',
      status: 'unread',
      type: input.type,
      title: input.title,
      body: input.body,
      metadata: input.metadata,
    });
  }

  async findRecentForAudience(
    tenantId: string,
    limit: number,
    audience: { kind: 'admin' } | { kind: 'member'; userId: string },
  ): Promise<NotificationDocument[]> {
    const filter =
      audience.kind === 'admin'
        ? { tenantId }
        : { tenantId, recipientUserId: audience.userId };
    return this.model
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  async markInAppReadByIdForAudience(input: {
    tenantId: string;
    notificationId: string;
    userId: string;
    listAsAdmin: boolean;
  }): Promise<NotificationDocument | null> {
    if (!Types.ObjectId.isValid(input.notificationId)) {
      return null;
    }
    const doc = await this.model
      .findOne({
        _id: new Types.ObjectId(input.notificationId),
        tenantId: input.tenantId,
      })
      .exec();
    if (!doc) {
      return null;
    }
    if (!input.listAsAdmin && doc.recipientUserId !== input.userId) {
      return null;
    }
    doc.status = 'read';
    return doc.save();
  }
}
