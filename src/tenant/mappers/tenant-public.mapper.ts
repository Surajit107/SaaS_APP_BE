import { TenantDocument } from '../schemas/tenant.schema';
import type { TenantPublic } from '../types/tenant-public.types';

/** Maps persisted tenant docs to API-safe payloads (reuse for tenant scope + platform list). */
export function toTenantPublic(doc: TenantDocument): TenantPublic {
  const createdAt = doc.get('createdAt') as Date | undefined;
  const updatedAt = doc.get('updatedAt') as Date | undefined;
  return {
    id: doc.tenantId,
    name: doc.name,
    isActive: doc.isActive,
    createdAt: (createdAt ?? new Date(0)).toISOString(),
    updatedAt: (updatedAt ?? new Date(0)).toISOString(),
    deletedAt: doc.deletedAt ? doc.deletedAt.toISOString() : null,
    purgeAt: doc.purgeAt ? doc.purgeAt.toISOString() : null,
  };
}
