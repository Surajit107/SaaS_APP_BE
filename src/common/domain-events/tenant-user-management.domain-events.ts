import type { TenantUserRole } from '../../user/schemas/user.schema';

/** In-process domain events: tenant user management lifecycle. */
export const TenantUserManagementEventName = {
  UserInvited: 'tenant.user.invited',
  UserDeleted: 'tenant.user.deleted',
} as const;

export interface TenantUserInvitedPayload {
  tenantId: string;
  tenantName: string;
  invitedByUserId: string;
  invitedByEmail: string;
  invitedByDisplayName?: string;
  email: string;
  displayName?: string;
  role: TenantUserRole;
  /** Raw (unhashed) invite token — embedded in the email link. Never persisted beyond this event. */
  rawToken: string;
}

export interface TenantUserDeletedPayload {
  tenantId: string;
  deletedUserId: string;
  deletedEmail: string;
  deletedByUserId: string;
}
