import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { isMongooseConnectionReady } from '../../common/mongoose/connection.util';
import {
  RefreshToken,
  RefreshTokenDocument,
} from '../schemas/refresh-token.schema';

export interface CreateRefreshTokenRecordInput {
  jti: string;
  userId: Types.ObjectId;
  tenantId: string;
  secretHash: string;
  familyId: string;
  expiresAt: Date;
}

@Injectable()
export class RefreshTokenRepository {
  constructor(
    @InjectModel(RefreshToken.name)
    private readonly model: Model<RefreshToken>,
  ) {}

  isMongooseReady(): boolean {
    return isMongooseConnectionReady(this.model.db);
  }

  async findByJti(jti: string): Promise<RefreshTokenDocument | null> {
    return this.model.findOne({ jti }).exec();
  }

  async createToken(
    input: CreateRefreshTokenRecordInput,
    session?: ClientSession,
  ): Promise<RefreshTokenDocument> {
    const doc = new this.model({
      jti: input.jti,
      userId: input.userId,
      tenantId: input.tenantId,
      secretHash: input.secretHash,
      familyId: input.familyId,
      expiresAt: input.expiresAt,
    });
    if (session) {
      return doc.save({ session });
    }
    return doc.save();
  }

  async deleteByJti(jti: string): Promise<void> {
    await this.model.deleteOne({ jti }).exec();
  }

  /**
   * Invalidates a refresh family (e.g. password change). Optional for later use.
   */
  async deleteByFamilyId(familyId: string): Promise<void> {
    await this.model.deleteMany({ familyId }).exec();
  }
}
