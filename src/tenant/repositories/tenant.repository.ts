import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types, type QueryFilter } from 'mongoose';
import { isMongooseConnectionReady } from '../../common/mongoose/connection.util';
import { TENANT_SOFT_DELETE_PURGE_AFTER_MS } from '../constants/tenant-soft-delete.constants';
import { tenantActiveFilter } from '../filters/tenant-active.filter';
import { Tenant, TenantDocument } from '../schemas/tenant.schema';

function escapeMongoRegexLiteral(fragment: string): string {
  return fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface CreateTenantRecordInput {
  name: string;
  isActive?: boolean;
}

export interface UpdateTenantRecordInput {
  name?: string;
  isActive?: boolean;
}

@Injectable()
export class TenantRepository {
  constructor(
    @InjectModel(Tenant.name) private readonly model: Model<Tenant>,
  ) {}

  isMongooseReady(): boolean {
    return isMongooseConnectionReady(this.model.db);
  }

  async create(
    input: CreateTenantRecordInput,
    session?: ClientSession,
  ): Promise<TenantDocument> {
    const _id = new Types.ObjectId();
    const doc = new this.model({
      _id,
      tenantId: _id.toString(),
      name: input.name.trim(),
      isActive: input.isActive ?? true,
      deletedAt: null,
    });
    if (session) {
      return doc.save({ session });
    }
    return doc.save();
  }

  async deleteById(
    id: string | Types.ObjectId,
    session?: ClientSession,
  ): Promise<void> {
    const oid = typeof id === 'string' ? new Types.ObjectId(id) : id;
    const q = this.model.deleteOne({ _id: oid });
    if (session) {
      q.session(session);
    }
    await q.exec();
  }

  /**
   * Tenant in any lifecycle state (includes soft-deleted with `purgeAt`).
   * Use for platform admin lookups by id; prefer `findActiveByTenantId` for auth/tenant scope.
   */
  findByTenantId(tenantId: string): Promise<TenantDocument | null> {
    return this.model.findOne({ tenantId }).exec();
  }

  /** Active / not soft-deleted — use for JWT tenant scope and auth. */
  findActiveByTenantId(tenantId: string): Promise<TenantDocument | null> {
    return this.model
      .findOne({
        tenantId,
        ...tenantActiveFilter(),
      })
      .exec();
  }

  async updateByTenantId(
    tenantId: string,
    input: UpdateTenantRecordInput,
    session?: ClientSession,
  ): Promise<TenantDocument | null> {
    const set: Record<string, string | boolean> = {};
    if (input.name !== undefined) {
      set.name = input.name.trim();
    }
    if (input.isActive !== undefined) {
      set.isActive = input.isActive;
    }
    const filter = {
      tenantId,
      ...tenantActiveFilter(),
    };
    if (Object.keys(set).length === 0) {
      return this.findActiveByTenantId(tenantId);
    }
    const q = this.model.findOneAndUpdate(
      filter,
      { $set: set },
      { returnDocument: 'after' },
    );
    if (session) {
      q.session(session);
    }
    return q.exec();
  }

  /**
   * Soft delete: sets `deletedAt`, `purgeAt` (≈30d for TTL), clears active flag.
   * Returns null if not found or already soft-deleted.
   */
  softDeleteByTenantId(
    tenantId: string,
    session?: ClientSession,
  ): Promise<TenantDocument | null> {
    const now = new Date();
    const purgeAt = new Date(now.getTime() + TENANT_SOFT_DELETE_PURGE_AFTER_MS);
    const filter = {
      tenantId,
      ...tenantActiveFilter(),
    };
    const q = this.model.findOneAndUpdate(
      filter,
      {
        $set: {
          deletedAt: now,
          purgeAt,
          isActive: false,
        },
      },
      { returnDocument: 'after' },
    );
    if (session) {
      q.session(session);
    }
    return q.exec();
  }

  /**
   * Cross-tenant listing for platform operators only. Do not call from tenant-scoped services.
   */
  async findManyPaginatedForPlatformAdmin(opts: {
    skip: number;
    limit: number;
    includeDeleted?: boolean;
    /** Case-insensitive substring match on name or tenantId */
    search?: string;
    isActive?: boolean;
  }): Promise<{ items: TenantDocument[]; total: number }> {
    const filter = this.buildPlatformAdminListFilter(opts);
    const q = this.model
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(opts.skip)
      .limit(opts.limit);
    const [items, total] = await Promise.all([
      q.exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return { items, total };
  }

  private buildPlatformAdminListFilter(opts: {
    includeDeleted?: boolean;
    search?: string;
    isActive?: boolean;
  }): QueryFilter<Tenant> {
    const parts: QueryFilter<Tenant>[] = [];
    if (opts.includeDeleted !== true) {
      parts.push(tenantActiveFilter());
    }
    if (opts.isActive !== undefined) {
      parts.push({ isActive: opts.isActive });
    }
    const q = opts.search?.trim();
    if (q && q.length > 0) {
      const safe = escapeMongoRegexLiteral(q);
      parts.push({
        $or: [
          { name: { $regex: safe, $options: 'i' } },
          { tenantId: { $regex: safe, $options: 'i' } },
        ],
      });
    }
    if (parts.length === 0) {
      return {};
    }
    if (parts.length === 1) {
      return parts[0];
    }
    return { $and: parts };
  }

  countActiveForPlatformAdmin(): Promise<number> {
    return this.model.countDocuments(tenantActiveFilter()).exec();
  }

  /** Documents soft-deleted but not yet removed by TTL monitor. */
  countPendingPurgeForPlatformAdmin(): Promise<number> {
    return this.model
      .countDocuments({
        purgeAt: { $exists: true },
      })
      .exec();
  }

  countAllForPlatformAdmin(): Promise<number> {
    return this.model.countDocuments({}).exec();
  }
}
