import type { QueryFilter } from 'mongoose';
import type { Tenant } from '../schemas/tenant.schema';

/**
 * Matches tenant docs that are not soft-deleted (field missing, null, or unset for legacy rows).
 */
export function tenantActiveFilter(): QueryFilter<Tenant> {
  return {
    $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
  };
}
