export function workspaceBoardRoom(params: {
  tenantId: string;
  workspaceId: string;
}): string {
  return `tenant:${params.tenantId}:workspace:${params.workspaceId}`;
}

/** Per-user room for cross-workspace “My tasks” list (assignee inbox). */
export function memberMyTasksRoom(params: { tenantId: string; userId: string }): string {
  return `tenant:${params.tenantId}:user:${params.userId}:my-tasks`;
}
