/**
 * Tenant fields safe to return to authenticated members of the organization.
 * `id` is the canonical tenant identifier (matches JWT `tenantId`).
 */
export interface TenantPublic {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** Present when organization is soft-deleted (awaiting TTL purge). */
  deletedAt: string | null;
  /** Absolute time when MongoDB TTL will remove the tenant document. */
  purgeAt: string | null;
}
