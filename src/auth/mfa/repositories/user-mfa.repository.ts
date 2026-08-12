import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { isMongooseConnectionReady } from '../../../common/mongoose/connection.util';
import {
  MfaBackupCode,
  UserMfa,
  UserMfaDocument,
} from '../schemas/user-mfa.schema';

const SECRET_FIELDS =
  '+totpSecretEncrypted +pendingTotpSecretEncrypted +backupCodes';

export interface StartTotpEnrollmentInput {
  userId: string;
  tenantId: string;
  pendingTotpSecretEncrypted: string;
  pendingTotpExpiresAt: Date;
}

export interface ActivateTotpInput {
  userId: string;
  totpSecretEncrypted: string;
  backupCodes: MfaBackupCode[];
}

@Injectable()
export class UserMfaRepository {
  constructor(
    @InjectModel(UserMfa.name)
    private readonly model: Model<UserMfa>,
  ) {}

  isMongooseReady(): boolean {
    return isMongooseConnectionReady(this.model.db);
  }

  /** Flags and counters only — never returns secret material. */
  async findByUserId(userId: string): Promise<UserMfaDocument | null> {
    const objectId = toObjectId(userId);
    if (objectId === null) {
      return null;
    }
    return this.model.findOne({ userId: objectId }).exec();
  }

  /** Includes the encrypted secrets and backup codes. Use only on verification paths. */
  async findByUserIdWithSecrets(
    userId: string,
  ): Promise<UserMfaDocument | null> {
    const objectId = toObjectId(userId);
    if (objectId === null) {
      return null;
    }
    return this.model
      .findOne({ userId: objectId })
      .select(SECRET_FIELDS)
      .exec();
  }

  /**
   * Stores a not-yet-confirmed authenticator secret. Overwrites any previous
   * pending secret so restarting enrollment invalidates an abandoned QR code.
   */
  async startTotpEnrollment(
    input: StartTotpEnrollmentInput,
  ): Promise<UserMfaDocument> {
    const objectId = requireObjectId(input.userId);
    const doc = await this.model
      .findOneAndUpdate(
        { userId: objectId },
        {
          $set: {
            tenantId: input.tenantId,
            pendingTotpSecretEncrypted: input.pendingTotpSecretEncrypted,
            pendingTotpExpiresAt: input.pendingTotpExpiresAt,
          },
          $setOnInsert: { userId: objectId },
        },
        {
          upsert: true,
          returnDocument: 'after',
          setDefaultsOnInsert: true,
        },
      )
      .exec();
    if (!doc) {
      throw new Error('Failed to persist TOTP enrollment');
    }
    return doc;
  }

  /**
   * Promotes the pending secret to active and installs a fresh set of backup codes.
   *
   * `lastUsedTotpStep` is deliberately left unset: replay tracking starts at the
   * first *login*. Counting the enrollment code would reject a correct code for
   * the rest of that 30-second window — a confusing failure for a user who signs
   * in on a second device right after setup — while preventing nothing, since
   * anyone holding the password could simply wait for the next code.
   */
  async activateTotp(
    input: ActivateTotpInput,
    session?: ClientSession,
  ): Promise<UserMfaDocument | null> {
    const objectId = requireObjectId(input.userId);
    const query = this.model.findOneAndUpdate(
      { userId: objectId },
      {
        $set: {
          totpSecretEncrypted: input.totpSecretEncrypted,
          isTotpEnabled: true,
          totpEnabledAt: new Date(),
          backupCodes: input.backupCodes,
          backupCodesGeneratedAt: new Date(),
        },
        $unset: {
          pendingTotpSecretEncrypted: '',
          pendingTotpExpiresAt: '',
          lastUsedTotpStep: '',
        },
      },
      { returnDocument: 'after' },
    );
    if (session) query.session(session);
    return query.exec();
  }

  async disableTotp(userId: string): Promise<UserMfaDocument | null> {
    const objectId = requireObjectId(userId);
    return this.model
      .findOneAndUpdate(
        { userId: objectId },
        {
          $set: { isTotpEnabled: false, backupCodes: [] },
          $unset: {
            totpSecretEncrypted: '',
            pendingTotpSecretEncrypted: '',
            pendingTotpExpiresAt: '',
            totpEnabledAt: '',
            lastUsedTotpStep: '',
            backupCodesGeneratedAt: '',
          },
        },
        { returnDocument: 'after' },
      )
      .exec();
  }

  /**
   * Records the accepted time-step, rejecting the update if a concurrent
   * request already consumed that step or a later one (replay protection).
   */
  async tryConsumeTotpStep(userId: string, step: number): Promise<boolean> {
    const objectId = toObjectId(userId);
    if (objectId === null) {
      return false;
    }
    const result = await this.model
      .updateOne(
        {
          userId: objectId,
          $or: [
            { lastUsedTotpStep: { $exists: false } },
            { lastUsedTotpStep: { $lt: step } },
          ],
        },
        { $set: { lastUsedTotpStep: step } },
      )
      .exec();
    return result.modifiedCount === 1;
  }

  /** Marks one unused backup code as spent. Returns false if it was already used. */
  async markBackupCodeUsed(userId: string, codeHash: string): Promise<boolean> {
    const objectId = toObjectId(userId);
    if (objectId === null) {
      return false;
    }
    const result = await this.model
      .updateOne(
        {
          userId: objectId,
          backupCodes: { $elemMatch: { codeHash, usedAt: { $exists: false } } },
        },
        { $set: { 'backupCodes.$.usedAt': new Date() } },
      )
      .exec();
    return result.modifiedCount === 1;
  }

  async replaceBackupCodes(
    userId: string,
    backupCodes: MfaBackupCode[],
  ): Promise<UserMfaDocument | null> {
    const objectId = requireObjectId(userId);
    return this.model
      .findOneAndUpdate(
        { userId: objectId },
        { $set: { backupCodes, backupCodesGeneratedAt: new Date() } },
        { returnDocument: 'after' },
      )
      .exec();
  }

  async setEmailCodeLoginEnabled(
    userId: string,
    tenantId: string,
    isEnabled: boolean,
  ): Promise<UserMfaDocument> {
    const objectId = requireObjectId(userId);
    const doc = await this.model
      .findOneAndUpdate(
        { userId: objectId },
        {
          $set: { isEmailCodeLoginEnabled: isEnabled, tenantId },
          $setOnInsert: { userId: objectId },
        },
        {
          upsert: true,
          returnDocument: 'after',
          setDefaultsOnInsert: true,
        },
      )
      .exec();
    if (!doc) {
      throw new Error('Failed to persist MFA preferences');
    }
    return doc;
  }

  async deleteByUserId(userId: string, session?: ClientSession): Promise<void> {
    const objectId = toObjectId(userId);
    if (objectId === null) {
      return;
    }
    const query = this.model.deleteOne({ userId: objectId });
    if (session) query.session(session);
    await query.exec();
  }
}

function toObjectId(userId: string): Types.ObjectId | null {
  return Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : null;
}

function requireObjectId(userId: string): Types.ObjectId {
  const objectId = toObjectId(userId);
  if (objectId === null) {
    throw new Error(`Invalid user id: ${userId}`);
  }
  return objectId;
}
