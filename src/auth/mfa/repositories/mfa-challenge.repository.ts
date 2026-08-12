import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { isMongooseConnectionReady } from '../../../common/mongoose/connection.util';
import type {
  AuthLoginScope,
  TenantLoginPortalRole,
} from '../../dto/login.dto';
import {
  MfaChallenge,
  MfaChallengeDocument,
  MfaChallengePurpose,
} from '../schemas/mfa-challenge.schema';

export interface CreateMfaChallengeInput {
  jti: string;
  secretHash: string;
  userId?: string;
  tenantId: string;
  purpose: MfaChallengePurpose;
  authScope: AuthLoginScope;
  tenantRole?: TenantLoginPortalRole;
  codeHash?: string;
  maxAttempts: number;
  expiresAt: Date;
}

@Injectable()
export class MfaChallengeRepository {
  constructor(
    @InjectModel(MfaChallenge.name)
    private readonly model: Model<MfaChallenge>,
  ) {}

  isMongooseReady(): boolean {
    return isMongooseConnectionReady(this.model.db);
  }

  async create(input: CreateMfaChallengeInput): Promise<MfaChallengeDocument> {
    const doc = new this.model({
      jti: input.jti,
      secretHash: input.secretHash,
      userId:
        input.userId !== undefined && Types.ObjectId.isValid(input.userId)
          ? new Types.ObjectId(input.userId)
          : undefined,
      tenantId: input.tenantId,
      purpose: input.purpose,
      authScope: input.authScope,
      tenantRole: input.tenantRole,
      codeHash: input.codeHash,
      maxAttempts: input.maxAttempts,
      expiresAt: input.expiresAt,
    });
    return doc.save();
  }

  /** Includes `codeHash`, which is needed to verify emailed one-time codes. */
  async findByJtiWithCode(jti: string): Promise<MfaChallengeDocument | null> {
    return this.model.findOne({ jti }).select('+codeHash').exec();
  }

  /**
   * Atomically counts a failed guess and reports how many were used, so the
   * caller can retire the challenge once `maxAttempts` is reached.
   */
  async recordFailedAttempt(jti: string): Promise<number | null> {
    const doc = await this.model
      .findOneAndUpdate(
        { jti },
        { $inc: { attemptCount: 1 } },
        { returnDocument: 'after' },
      )
      .exec();
    return doc?.attemptCount ?? null;
  }

  /** Single-use consumption: succeeds only for a challenge not already spent. */
  async tryConsume(jti: string): Promise<boolean> {
    const result = await this.model
      .updateOne(
        { jti, consumedAt: { $exists: false } },
        { $set: { consumedAt: new Date() } },
      )
      .exec();
    return result.modifiedCount === 1;
  }

  async deleteByJti(jti: string): Promise<void> {
    await this.model.deleteOne({ jti }).exec();
  }

  /** Clears outstanding challenges, e.g. after a successful sign-in or a security change. */
  async deleteByUserId(userId: string): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) {
      return;
    }
    await this.model.deleteMany({ userId: new Types.ObjectId(userId) }).exec();
  }
}
