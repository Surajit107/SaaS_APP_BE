export function notificationUserRoom(params: {
  tenantId: string;
  userId: string;
}): string {
  return `tenant:${params.tenantId}:user:${params.userId}`;
}

export function notificationAdminRoom(params: { tenantId: string }): string {
  return `tenant:${params.tenantId}:admins`;
}
