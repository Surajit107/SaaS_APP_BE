import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UserMfaDocument = HydratedDocument<UserMfa>;

/** A single-use recovery code. `usedAt` is set instead of deleting, so a user can see how many remain. */
@Schema({ _id: false })
export class MfaBackupCode {
  @Prop({ required: true })
  codeHash: string;

  @Prop({ type: Date })
  usedAt?: Date;
}

export const MfaBackupCodeSchema = SchemaFactory.createForClass(MfaBackupCode);

/**
 * Per-user multi-factor state. Kept out of `User` so the sensitive material can
 * be selected deliberately rather than riding along on every user read.
 *
 * TOTP secrets are stored *encrypted*, not hashed: verifying a code requires
 * recomputing it from the original secret.
 */
@Schema({ timestamps: true, collection: 'user_mfa' })
export class UserMfa {
  @Prop({
    type: Types.ObjectId,
    required: true,
    unique: true,
    index: true,
    ref: 'User',
  })
  userId: Types.ObjectId;

  /**
   * Mirrors `User.tenantId`: org scope, or `''` for platform operators.
   * Avoid `required: true` on String — Mongoose rejects empty string.
   */
  @Prop({
    type: String,
    default: '',
    index: true,
    validate: {
      validator: (v: unknown): v is string => typeof v === 'string',
      message: 'tenantId must be a string',
    },
  })
  tenantId: string;

  /** Active authenticator secret, AES-256-GCM encrypted. */
  @Prop({ type: String, select: false })
  totpSecretEncrypted?: string;

  /** Set during enrollment; promoted to `totpSecretEncrypted` once a code is confirmed. */
  @Prop({ type: String, select: false })
  pendingTotpSecretEncrypted?: string;

  @Prop({ type: Date })
  pendingTotpExpiresAt?: Date;

  @Prop({ default: false, index: true })
  isTotpEnabled: boolean;

  @Prop({ type: Date })
  totpEnabledAt?: Date;

  /**
   * Highest TOTP time-step already accepted. Codes at or below this are
   * rejected so a stolen code cannot be replayed inside its validity window.
   */
  @Prop({ type: Number })
  lastUsedTotpStep?: number;

  @Prop({ type: [MfaBackupCodeSchema], default: [], select: false })
  backupCodes: MfaBackupCode[];

  @Prop({ type: Date })
  backupCodesGeneratedAt?: Date;

  /** Opt-out switch for passwordless "email me a code" sign-in. */
  @Prop({ default: true })
  isEmailCodeLoginEnabled: boolean;
}

export const UserMfaSchema = SchemaFactory.createForClass(UserMfa);
