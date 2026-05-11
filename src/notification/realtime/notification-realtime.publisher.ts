import { Injectable } from '@nestjs/common';
import type { NotificationDocument } from '../schemas/notification.schema';
import { NotificationRealtimeGateway } from './notification-realtime.gateway';
import { notificationAdminRoom, notificationUserRoom } from './notification-rooms';
import type { NotificationPushPayload } from './notification-realtime.types';

@Injectable()
export class NotificationRealtimePublisher {
  constructor(private readonly gateway: NotificationRealtimeGateway) {}

  publishCreated(doc: NotificationDocument): void {
    const createdAt = (doc as unknown as { createdAt?: Date }).createdAt;
    const payload: NotificationPushPayload = {
      id: String(doc._id),
      type: doc.type,
      title: doc.title,
      body: doc.body,
      status: doc.status,
      metadata: doc.metadata,
      createdAt:
        createdAt instanceof Date && !Number.isNaN(createdAt.getTime())
          ? createdAt.toISOString()
          : new Date().toISOString(),
    };

    const tenantId = doc.tenantId;
    const recipient = doc.recipientUserId;

    if (typeof recipient === 'string' && recipient.length > 0) {
      this.gateway.server
        .to(notificationUserRoom({ tenantId, userId: recipient }))
        .emit('notification:created', payload);
      return;
    }

    this.gateway.server
      .to(notificationAdminRoom({ tenantId }))
      .emit('notification:created', payload);
  }
}

