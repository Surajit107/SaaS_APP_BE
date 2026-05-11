export type NotificationSocketAuth = {
  token?: string;
};

export type NotificationPushPayload = {
  id: string;
  type: string;
  title: string;
  body?: string;
  status: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};
