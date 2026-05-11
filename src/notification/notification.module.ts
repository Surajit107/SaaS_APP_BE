import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BillingSubscriptionNotificationsListener } from './listeners/billing-subscription-notifications.listener';
import { TaskAssignedNotificationsListener } from './listeners/task-assigned-notifications.listener';
import { TenantRegisteredNotificationsListener } from './listeners/tenant-registered-notifications.listener';
import { NotificationRepository } from './repositories/notification.repository';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import {
  Notification,
  NotificationSchema,
} from './schemas/notification.schema';
import { NotificationRealtimeGateway } from './realtime/notification-realtime.gateway';
import { NotificationRealtimePublisher } from './realtime/notification-realtime.publisher';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
    ]),
  ],
  controllers: [NotificationController],
  providers: [
    NotificationRepository,
    NotificationService,
    NotificationRealtimeGateway,
    NotificationRealtimePublisher,
    BillingSubscriptionNotificationsListener,
    TaskAssignedNotificationsListener,
    TenantRegisteredNotificationsListener,
  ],
  exports: [NotificationService],
})
export class NotificationModule {}
