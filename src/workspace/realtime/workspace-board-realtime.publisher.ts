import { Injectable } from '@nestjs/common';
import { WorkspaceBoardRealtimeGateway } from './workspace-board-realtime.gateway';
import { memberMyTasksRoom, workspaceBoardRoom } from './workspace-board-rooms';
import type {
  MemberMyTasksChangedPayload,
  WorkspaceTasksChangedPayload,
} from './workspace-board-realtime.types';

@Injectable()
export class WorkspaceBoardRealtimePublisher {
  constructor(private readonly gateway: WorkspaceBoardRealtimeGateway) {}

  publishTasksChanged(tenantId: string, workspaceId: string): void {
    const payload: WorkspaceTasksChangedPayload = { workspaceId };
    this.gateway.server
      .to(workspaceBoardRoom({ tenantId, workspaceId }))
      .emit('workspace:tasks:changed', payload);
  }

  publishMemberMyTasksChanged(tenantId: string, userId: string): void {
    const payload: MemberMyTasksChangedPayload = {};
    this.gateway.server
      .to(memberMyTasksRoom({ tenantId, userId }))
      .emit('member-tasks:changed', payload);
  }
}
