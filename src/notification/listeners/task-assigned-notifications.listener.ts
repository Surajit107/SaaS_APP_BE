import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  TaskEventName,
  type TaskAssignedEventPayload,
} from '../../common/domain-events/task.domain-events';
import { NotificationService } from '../notification.service';

@Injectable()
export class TaskAssignedNotificationsListener {
  private readonly log = new Logger(TaskAssignedNotificationsListener.name);

  constructor(private readonly notifications: NotificationService) {}

  @OnEvent(TaskEventName.Assigned)
  async onTaskAssigned(payload: TaskAssignedEventPayload): Promise<void> {
    try {
      await this.notifications.notifyTenant({
        tenantId: payload.tenantId,
        recipientUserId: payload.assignedTo,
        type: 'task_assigned',
        title: 'New task assigned to you',
        body: 'Open your workspace dashboard to view and update the task.',
        metadata: {
          taskId: payload.taskId,
          assignedBy: payload.assignedBy,
        },
      });
    } catch (err) {
      this.log.error(
        err instanceof Error
          ? err.message
          : 'task_assigned notification failed',
        err instanceof Error ? err.stack : undefined,
      );
    }
  }
}
