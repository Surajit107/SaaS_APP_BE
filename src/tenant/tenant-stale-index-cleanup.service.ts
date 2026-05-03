import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Tenant } from './schemas/tenant.schema';

const OBSOLETE_TENANT_INDEX = 'displayNameKey_1';

/** MongoDB: IndexNotFound — obsolete index already absent */
const MONGO_INDEX_NOT_FOUND = 27;
/** MongoDB: NamespaceNotFound — collection not created yet (first boot) */
const MONGO_NAMESPACE_NOT_FOUND = 26;

/**
 * Legacy DBs may keep a unique index on a removed field, causing E11000 on
 * { displayNameKey: null } for every insert. Dropping the index fixes it.
 */
@Injectable()
export class TenantStaleIndexCleanupService implements OnModuleInit {
  private readonly logger = new Logger(TenantStaleIndexCleanupService.name);

  constructor(
    @InjectModel(Tenant.name) private readonly model: Model<Tenant>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.model.collection.dropIndex(OBSOLETE_TENANT_INDEX);
      this.logger.log(
        `Removed obsolete index ${OBSOLETE_TENANT_INDEX} from tenants`,
      );
    } catch (e: unknown) {
      const code =
        e && typeof e === 'object' && 'code' in e
          ? (e as { code: number }).code
          : undefined;
      // 27: index missing. 26: tenants collection does not exist yet (first run).
      if (
        code === MONGO_INDEX_NOT_FOUND ||
        code === MONGO_NAMESPACE_NOT_FOUND
      ) {
        return;
      }
      this.logger.debug(
        { err: e },
        `Skip dropping ${OBSOLETE_TENANT_INDEX} (not present or not applicable)`,
      );
    }
  }
}
