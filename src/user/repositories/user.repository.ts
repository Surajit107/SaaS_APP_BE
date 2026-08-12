import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { isMongooseConnectionReady } from '../../common/mongoose/connection.util';
import { User, UserDocument, TenantUserRole } from '../schemas/user.schema';

export interface CreateUserRecordInput {
  tenantId: string;
  email: string;
  passwordHash?: string;
  role?: TenantUserRole;
  displayName?: string;
  /** Defaults to true; set false for invited-but-not-yet-accepted users. */
  isActive?: boolean;
  /** When omitted, schema default applies (typically false for new rows). */
  isEmailVerified?: boolean;
  emailVerifyTokenHash?: string;
  emailVerifyExpiresAt?: Date;
}

export interface TenantUserListOptions {
  page: number;
  limit: number;
  /** Filter by email or displayName (case-insensitive prefix/contains). */
  search?: string;
}

export interface TenantUserListResult {
  docs: UserDocument[];
  total: number;
}

export interface UpdateUserFields {
  displayName?: string;
  role?: TenantUserRole;
  isActive?: boolean;
  passwordHash?: string;
  isEmailVerified?: boolean;
}

@Injectable()
export class UserRepository {
  constructor(@InjectModel(User.name) private readonly model: Model<User>) {}

  isMongooseReady(): boolean {
    return isMongooseConnectionReady(this.model.db);
  }

  async findById(id: string): Promise<UserDocument | null> {
    if (!Types.ObjectId.isValid(id)) {
      return null;
    }
    return this.model.findById(new Types.ObjectId(id)).exec();
  }

  async findByEmailInTenant(
    email: string,
    tenantId: string,
  ): Promise<UserDocument | null> {
    return this.model
      .findOne({ email: email.toLowerCase().trim(), tenantId })
      .exec();
  }

  /**
   * Global email lookup (one account per email for auth; tenantId is derived from JWT after login).
   */
  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.model.findOne({ email: email.toLowerCase().trim() }).exec();
  }

  /**
   * Loads `emailVerifyTokenHash` (normally select:false) for the verify-email flow.
   */
  async findByEmailWithEmailVerificationFields(
    email: string,
  ): Promise<UserDocument | null> {
    return this.model
      .findOne({ email: email.toLowerCase().trim() })
      .select('+emailVerifyTokenHash')
      .exec();
  }

  /**
   * Includes passwordHash for local credential verification.
   */
  async findByEmailInTenantWithCredentials(
    email: string,
    tenantId: string,
  ): Promise<UserDocument | null> {
    return this.model
      .findOne({ email: email.toLowerCase().trim(), tenantId })
      .select('+passwordHash')
      .exec();
  }

  /**
   * Login: email is globally unique; tenant scope comes from the user document.
   */
  async findByEmailWithCredentials(
    email: string,
  ): Promise<UserDocument | null> {
    return this.model
      .findOne({ email: email.toLowerCase().trim() })
      .select('+passwordHash +emailVerifyTokenHash')
      .exec();
  }

  /** Refresh rotation: needs verification token fields for tenant email gate. */
  async findByIdForTokenRefresh(userId: string): Promise<UserDocument | null> {
    if (!Types.ObjectId.isValid(userId)) {
      return null;
    }
    return this.model
      .findById(new Types.ObjectId(userId))
      .select('+emailVerifyTokenHash')
      .exec();
  }

  async createUser(
    input: CreateUserRecordInput,
    session?: ClientSession,
  ): Promise<UserDocument> {
    const doc = new this.model({
      tenantId: input.tenantId,
      email: input.email.toLowerCase().trim(),
      passwordHash: input.passwordHash,
      isPlatformAdmin: false,
      role: input.role ?? 'member',
      displayName: input.displayName?.trim(),
      isActive: input.isActive ?? true,
      ...(input.isEmailVerified !== undefined
        ? { isEmailVerified: input.isEmailVerified }
        : {}),
      ...(input.emailVerifyTokenHash !== undefined &&
      input.emailVerifyExpiresAt !== undefined
        ? {
            emailVerifyTokenHash: input.emailVerifyTokenHash,
            emailVerifyExpiresAt: input.emailVerifyExpiresAt,
          }
        : {}),
    });
    if (session) {
      return doc.save({ session });
    }
    return doc.save();
  }

  /** Tenant-scoped paginated list; platform admin is excluded from results. */
  async findAllByTenantId(
    tenantId: string,
    opts: TenantUserListOptions,
  ): Promise<TenantUserListResult> {
    const { page, limit, search } = opts;
    const baseFilter = { tenantId, isPlatformAdmin: false };
    const searchFilter =
      search && search.trim().length > 0
        ? {
            $or: [
              {
                email: {
                  $regex: search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
                  $options: 'i',
                },
              },
              {
                displayName: {
                  $regex: search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
                  $options: 'i',
                },
              },
            ],
          }
        : {};
    const filter = { ...baseFilter, ...searchFilter };
    const skip = (page - 1) * limit;
    const [docs, total] = await Promise.all([
      this.model.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return { docs, total };
  }

  /**
   * Cross-tenant lookup for platform operators, used to find an account that is
   * locked out of its second factor. Search is required by the caller so this
   * never turns into a full directory dump.
   */
  async searchForPlatformAdmin(
    search: string,
    limit: number,
  ): Promise<UserDocument[]> {
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (escaped.length === 0) {
      return [];
    }
    return this.model
      .find({
        $or: [
          { email: { $regex: escaped, $options: 'i' } },
          { displayName: { $regex: escaped, $options: 'i' } },
        ],
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  /** Tenant-scoped single-user lookup (never crosses tenant boundary). */
  async findByIdAndTenantId(
    userId: string,
    tenantId: string,
  ): Promise<UserDocument | null> {
    if (!Types.ObjectId.isValid(userId)) {
      return null;
    }
    return this.model
      .findOne({ _id: new Types.ObjectId(userId), tenantId })
      .exec();
  }

  /**
   * Sets or clears `displayName` for a user in a tenant (tenantId enforced on the filter).
   * Pass `null` for `displayName` to remove the field.
   */
  async updateDisplayNameByIdAndTenantId(
    userId: string,
    tenantId: string,
    displayName: string | null,
    session?: ClientSession,
  ): Promise<UserDocument | null> {
    if (!Types.ObjectId.isValid(userId)) {
      return null;
    }
    const filter = { _id: new Types.ObjectId(userId), tenantId };
    if (displayName === null) {
      const q = this.model.findOneAndUpdate(
        filter,
        { $unset: { displayName: 1 } },
        { returnDocument: 'after' },
      );
      if (session) {
        q.session(session);
      }
      return q.exec();
    }
    const q = this.model.findOneAndUpdate(
      filter,
      { $set: { displayName } },
      { returnDocument: 'after' },
    );
    if (session) {
      q.session(session);
    }
    return q.exec();
  }

  /** Update specific fields on a user; returns the updated document. */
  async updateById(
    userId: string,
    fields: UpdateUserFields,
    session?: ClientSession,
  ): Promise<UserDocument | null> {
    if (!Types.ObjectId.isValid(userId)) {
      return null;
    }
    const q = this.model.findByIdAndUpdate(
      new Types.ObjectId(userId),
      { $set: fields },
      { returnDocument: 'after' },
    );
    if (session) {
      q.session(session);
    }
    return q.exec();
  }

  /**
   * Hard-delete a user from a tenant.
   * Enforces tenantId so a caller can never delete across org boundaries.
   */
  async deleteByIdAndTenantId(
    userId: string,
    tenantId: string,
    session?: ClientSession,
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(userId)) {
      return false;
    }
    const q = this.model.deleteOne({ _id: new Types.ObjectId(userId), tenantId });
    if (session) q.session(session);
    const result = await q.exec();
    return result.deletedCount > 0;
  }

  countByTenantId(tenantId: string): Promise<number> {
    return this.model.countDocuments({ tenantId, isPlatformAdmin: false }).exec();
  }

  /**
   * Platform operator flag — only call from controlled paths (e.g. seed), never from public register.
   */
  async setPlatformAdmin(
    userId: string,
    value: boolean,
    session?: ClientSession,
  ): Promise<void> {
    const q = this.model.updateOne(
      { _id: new Types.ObjectId(userId) },
      { $set: { isPlatformAdmin: value } },
    );
    if (session) {
      q.session(session);
    }
    await q.exec();
  }

  /**
   * Seed / migration only: updates `users` only — does not touch `tenants`.
   * Sets platform admin with empty `tenantId` (operators are not backed by a tenant document).
   */
  async ensurePlatformAdminNoTenant(
    userId: string,
    session?: ClientSession,
  ): Promise<void> {
    const q = this.model.updateOne(
      { _id: new Types.ObjectId(userId) },
      {
        $set: {
          isPlatformAdmin: true,
          tenantId: '',
          isEmailVerified: true,
        },
        $unset: { emailVerifyTokenHash: 1, emailVerifyExpiresAt: 1 },
      },
    );
    if (session) {
      q.session(session);
    }
    await q.exec();
  }

  async markEmailVerifiedAndClearVerificationToken(
    userId: string,
    session?: ClientSession,
  ): Promise<UserDocument | null> {
    if (!Types.ObjectId.isValid(userId)) {
      return null;
    }
    const q = this.model.findByIdAndUpdate(
      new Types.ObjectId(userId),
      {
        $set: { isEmailVerified: true },
        $unset: { emailVerifyTokenHash: 1, emailVerifyExpiresAt: 1 },
      },
      { returnDocument: 'after' },
    );
    if (session) {
      q.session(session);
    }
    return q.exec();
  }

  /**
   * Cross-tenant aggregate for platform operators only.
   */
  countAllForPlatformAdmin(): Promise<number> {
    return this.model.countDocuments({}).exec();
  }

  /**
   * First user in the org (by `createdAt`) — used for tenant-scoped email (e.g. billing alerts).
   */
  async findEarliestUserEmailByTenantId(
    tenantId: string,
  ): Promise<string | null> {
    if (!tenantId || !Types.ObjectId.isValid(tenantId)) {
      return null;
    }
    const doc = await this.model
      .findOne({ tenantId })
      .sort({ createdAt: 1 })
      .select('email')
      .lean<{ email: string }>()
      .exec();
    return doc?.email ?? null;
  }
}
