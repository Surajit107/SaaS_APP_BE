import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type { TenantUserRole } from '../../user/schemas/user.schema';

export type TenantUserInviteDocument = HydratedDocument<TenantUserInvite>;

/** Expiry window for a pending invite (48 hours). */
export const INVITE_EXPIRES_IN_MS = 48 * 60 * 60 * 1000;

@Schema({ timestamps: true, collection: 'tenant_user_invites' })
export class TenantUserInvite {
  @Prop({ required: true, index: true })
  tenantId: string;

  /** Normalised (lowercase, trimmed) email of the invited user. */
  @Prop({ required: true, index: true })
  email: string;

  /**
   * Bcrypt hash of the raw invite token.
   * The raw token is sent in the invitation email and never stored in plain text.
   * `select: false` prevents accidental exposure in list queries.
   */
  @Prop({ required: true, select: false })
  tokenHash: string;

  /** Auto-removed by MongoDB TTL monitor when this date passes. */
  @Prop({ required: true })
  expiresAt: Date;

  /** userId (ObjectId string) of the tenant admin who created this invite. */
  @Prop({ required: true })
  invitedByUserId: string;

  @Prop({
    type: String,
    enum: ['admin', 'member'] satisfies TenantUserRole[],
    default: 'member',
  })
  role: TenantUserRole;

  @Prop({ type: String, trim: true })
  displayName?: string;
}

export const TenantUserInviteSchema =
  SchemaFactory.createForClass(TenantUserInvite);

/** One active invite per email per tenant; re-inviting replaces the old record. */
TenantUserInviteSchema.index(
  { tenantId: 1, email: 1 },
  { unique: true, name: 'tenant_user_invites_unique_email' },
);

/** Hard-delete the invite document when `expiresAt` passes. */
TenantUserInviteSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: 'tenant_user_invites_expiresAt_ttl' },
);
