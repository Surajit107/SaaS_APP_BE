export type WorkspaceBoardSocketAuth = {
  token?: string;
};

export type WorkspaceTasksChangedPayload = {
  workspaceId: string;
};

/** Payload for assignee task-list refresh (extensible later). */
export type MemberMyTasksChangedPayload = Record<string, never>;
