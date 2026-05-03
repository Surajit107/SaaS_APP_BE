export const TaskEventName = {
  Created: 'task.created',
  Assigned: 'task.assigned',
  Completed: 'task.completed',
} as const;

export type TaskCreatedEventPayload = {
  taskId: string;
  workspaceId: string;
  tenantId: string;
  createdBy: string;
  assignedTo: string | null;
  status: 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE';
};

export type TaskAssignedEventPayload = {
  taskId: string;
  workspaceId: string;
  tenantId: string;
  assignedTo: string;
  assignedBy: string;
};

export type TaskCompletedEventPayload = {
  taskId: string;
  workspaceId: string;
  tenantId: string;
  completedBy: string;
};
