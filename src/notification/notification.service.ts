import { Injectable, NotFoundException } from '@nestjs/common';
import type { ApiSuccessResponse } from '../common/types/api-response.types';
import type { AuthenticatedRequestUser } from '../auth/types/auth-request-user.types';
import {
  NotificationRepository,
  type CreateTenantNotificationInput,
} from './repositories/notification.repository';
import { NotificationRealtimePublisher } from './realtime/notification-realtime.publisher';

@Injectable()
export class NotificationService {
  constructor(
    private readonly notificationRepository: NotificationRepository,
    private readonly realtimePublisher: NotificationRealtimePublisher,
  ) {}

  getModuleStatus(): ApiSuccessResponse<{
    module: string;
    dbReady: boolean;
  }> {
    return {
      success: true,
      message: 'Notification module ready',
      data: {
        module: 'notification',
        dbReady: this.notificationRepository.isMongooseReady(),
      },
    };
  }

  async notifyTenant(input: CreateTenantNotificationInput): Promise<void> {
    const created = await this.notificationRepository.createInApp(input);
    this.realtimePublisher.publishCreated(created);
  }

  async listForCurrentUser(
    user: AuthenticatedRequestUser,
    limit: number,
  ): Promise<
    ApiSuccessResponse<
      Array<{
        id: string;
        type: string;
        title: string;
        body?: string;
        status: string;
        metadata?: Record<string, unknown>;
        createdAt: string;
      }>
    >
  > {
    const listAsAdmin =
      user.platformAdmin === true || user.tenantRole !== 'member';
    const rows = await this.notificationRepository.findRecentForAudience(
      user.tenantId,
      limit,
      listAsAdmin
        ? { kind: 'admin' }
        : { kind: 'member', userId: user.userId },
    );
    return {
      success: true,
      message: 'OK',
      data: rows.map((n) => ({
        id: String(n._id),
        type: n.type,
        title: n.title,
        body: n.body,
        status: n.status,
        metadata: n.metadata,
        createdAt: (
          n as unknown as { createdAt: Date }
        ).createdAt.toISOString(),
      })),
    };
  }

  async markInAppRead(
    user: AuthenticatedRequestUser,
    notificationId: string,
  ): Promise<
    ApiSuccessResponse<{
      id: string;
      status: string;
    }>
  > {
    const listAsAdmin =
      user.platformAdmin === true || user.tenantRole !== 'member';
    const updated = await this.notificationRepository.markInAppReadByIdForAudience(
      {
        tenantId: user.tenantId,
        notificationId,
        userId: user.userId,
        listAsAdmin,
      },
    );
    if (!updated) {
      throw new NotFoundException('Notification not found');
    }
    return {
      success: true,
      message: 'Marked read',
      data: {
        id: String(updated._id),
        status: updated.status,
      },
    };
  }

  async markAllInAppRead(
    user: AuthenticatedRequestUser,
  ): Promise<ApiSuccessResponse<{ matched: number; modified: number }>> {
    const listAsAdmin =
      user.platformAdmin === true || user.tenantRole !== 'member';
    const res = await this.notificationRepository.markAllInAppReadForAudience({
      tenantId: user.tenantId,
      userId: user.userId,
      listAsAdmin,
    });
    return {
      success: true,
      message: 'Marked all read',
      data: res,
    };
  }
}
