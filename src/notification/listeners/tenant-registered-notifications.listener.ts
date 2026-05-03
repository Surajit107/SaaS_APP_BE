import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  TenantAuthEventName,
  type TenantUserRegisteredPayload,
} from '../../common/domain-events/tenant-auth.domain-events';
import { NotificationService } from '../notification.service';

@Injectable()
export class TenantRegisteredNotificationsListener {
  private readonly log = new Logger(TenantRegisteredNotificationsListener.name);

  constructor(private readonly notifications: NotificationService) {}

  @OnEvent(TenantAuthEventName.UserRegistered)
  async onUserRegistered(payload: TenantUserRegisteredPayload): Promise<void> {
    try {
      await this.notifications.notifyTenant({
        tenantId: payload.tenantId,
        recipientUserId: payload.userId,
        type: 'organization_registered',
        title: `Welcome to ${payload.organizationName}`,
        body: 'Verify your email from the message we sent, then sign in. After that you can invite your team and explore billing when you need paid plans.',
        metadata: {
          userId: payload.userId,
          email: payload.email,
        },
      });
    } catch (err) {
      this.log.error(
        err instanceof Error
          ? err.message
          : 'user_registered notification failed',
        err instanceof Error ? err.stack : undefined,
      );
    }
  }
}
