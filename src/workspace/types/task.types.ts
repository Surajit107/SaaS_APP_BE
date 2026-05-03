export const TASK_STATUS_VALUES = [
  'TODO',
  'IN_PROGRESS',
  'BLOCKED',
  'DONE',
] as const;

export type TaskStatus = (typeof TASK_STATUS_VALUES)[number];

export type TaskStatusCounts = Record<TaskStatus, number>;

export type TaskPublic = {
  id: string;
  workspaceId: string;
  tenantId: string;
  title: string;
  description: string | null;
  attachmentUrls: string[];
  status: TaskStatus;
  assignedTo: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};
