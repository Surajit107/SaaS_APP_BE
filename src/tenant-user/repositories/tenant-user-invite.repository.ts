import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { isMongooseConnectionReady } from '../../common/mongoose/connection.util';
import type { TenantUserRole } from '../../user/schemas/user.schema';
import {
  TenantUserInvite,
  TenantUserInviteDocument,
  INVITE_EXPIRES_IN_MS,
} from '../schemas/tenant-user-invite.schema';

export interface CreateInviteInput {
  tenantId: string;
  email: string;
  tokenHash: string;
  invitedByUserId: string;
  role: TenantUserRole;
  displayName?: string;
}

@Injectable()
export class TenantUserInviteRepository {
  constructor(
    @InjectModel(TenantUserInvite.name)
    private readonly model: Model<TenantUserInvite>,
  ) {}

  isMongooseReady(): boolean {
    return isMongooseConnectionReady(this.model.db);
  }

  /**
   * Upserts an invite record. If one already exists for this email+tenant,
   * the token and expiry are refreshed (re-invite scenario).
   * Pass `session` to participate in a MongoDB multi-document transaction.
   *
   * Note: `findOneAndUpdate` with `upsert: true` is not fully atomic outside a
   * transaction on a replica set. Always call this inside a session when possible.
   */
  async upsert(
    input: CreateInviteInput,
    session?: ClientSession,
  ): Promise<TenantUserInviteDocument> {
    const expiresAt = new Date(Date.now() + INVITE_EXPIRES_IN_MS);
    const q = this.model.findOneAndUpdate(
      { tenantId: input.tenantId, email: input.email },
      {
        $set: {
          tokenHash: input.tokenHash,
          expiresAt,
          invitedByUserId: input.invitedByUserId,
          role: input.role,
          displayName: input.displayName,
        },
      },
      { upsert: true, returnDocument: 'after' },
    );
    if (session) q.session(session);
    const doc = await q.exec();
    if (!doc) {
      throw new Error('Failed to upsert invite record');
    }
    return doc;
  }

  /** Lookup by email (used during accept-invite flow). Selects tokenHash. */
  async findByEmailWithToken(
    email: string,
  ): Promise<TenantUserInviteDocument | null> {
    return this.model.findOne({ email }).select('+tokenHash').exec();
  }

  async findByEmailAndTenantId(
    email: string,
    tenantId: string,
  ): Promise<TenantUserInviteDocument | null> {
    return this.model.findOne({ email, tenantId }).exec();
  }

  async deleteByEmailAndTenantId(
    email: string,
    tenantId: string,
    session?: ClientSession,
  ): Promise<void> {
    const q = this.model.deleteOne({ email, tenantId });
    if (session) q.session(session);
    await q.exec();
  }

  async deleteById(id: string, session?: ClientSession): Promise<void> {
    if (!Types.ObjectId.isValid(id)) return;
    const q = this.model.deleteOne({ _id: new Types.ObjectId(id) });
    if (session) q.session(session);
    await q.exec();
  }
}
