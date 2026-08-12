import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  AUTH_LOGIN_SCOPES,
  TENANT_LOGIN_PORTAL_ROLES,
  type AuthLoginScope,
  type TenantLoginPortalRole,
} from '../../dto/login.dto';

export type MfaChallengeDocument = HydratedDocument<MfaChallenge>;

export const MFA_CHALLENGE_PURPOSES = ['totp', 'email_code'] as const;
export type MfaChallengePurpose = (typeof MFA_CHALLENGE_PURPOSES)[number];

/**
 * A pending second step in a sign-in. Issued once the first factor passes, and
 * exchanged for a token pair by `POST /auth/mfa/verify`.
 *
 * The client holds an opaque `{jti}.{secret}` string (same shape as refresh
 * tokens) while only the bcrypt hash of the secret is stored here. Everything
 * needed to finish the login is captured server-side at issue time, so the
 * second request cannot alter the scope or role it was granted under.
 */
@Schema({ timestamps: true, collection: 'mfa_challenges' })
export class MfaChallenge {
  @Prop({ required: true, unique: true, index: true })
  jti: string;

  @Prop({ required: true })
  secretHash: string;

  /**
   * Absent for decoy challenges issued against unknown email addresses, which
   * keep the "email me a code" response identical for real and fake accounts.
   */
  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  userId?: Types.ObjectId;

  /** Mirrors `User.tenantId`: org scope, or `''` for platform operators. */
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

  @Prop({ type: String, required: true, enum: MFA_CHALLENGE_PURPOSES })
  purpose: MfaChallengePurpose;

  @Prop({ type: String, required: true, enum: AUTH_LOGIN_SCOPES })
  authScope: AuthLoginScope;

  @Prop({ type: String, enum: TENANT_LOGIN_PORTAL_ROLES })
  tenantRole?: TenantLoginPortalRole;

  /** bcrypt hash of the emailed 6-digit code. Unused for `totp` challenges. */
  @Prop({ type: String, select: false })
  codeHash?: string;

  @Prop({ default: 0 })
  attemptCount: number;

  @Prop({ required: true })
  maxAttempts: number;

  @Prop({ type: Date })
  consumedAt?: Date;

  /** TTL: MongoDB removes the row shortly after this instant (TTL monitor cadence applies). */
  @Prop({ required: true })
  expiresAt: Date;
}

export const MfaChallengeSchema = SchemaFactory.createForClass(MfaChallenge);
/** Deletes document after `expiresAt` passes (`expireAfterSeconds: 0` = at that date threshold). */
MfaChallengeSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: 'mfa_challenges_expiresAt_ttl' },
);
