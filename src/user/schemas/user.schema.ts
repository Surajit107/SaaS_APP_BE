import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

/**
 * Tenant-scoped roles.
 * - 'admin'  — can manage users, settings, billing within their tenant.
 * - 'member' — standard user; cannot manage other users.
 *
 * Default is 'admin' so all pre-existing registered tenant-owners retain access
 * without a data migration. Invited users are always explicitly set to 'member' (or 'admin').
 */
export type TenantUserRole = 'admin' | 'member';

/**
 * All org membership and platform-operator identity live here only.
 * Platform operators (`isPlatformAdmin`) use `tenantId: ''` and have no corresponding row in `tenants`.
 */
@Schema({ timestamps: true, collection: 'users' })
export class User {
  /**
   * Org scope; empty when `isPlatformAdmin` (no matching `tenants` document).
   * Do not use `required: true` here — Mongoose treats `''` as failing required for strings.
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

  @Prop({ required: true })
  email: string;

  @Prop({ required: false, select: false })
  passwordHash?: string;

  @Prop({ default: false })
  isEmailVerified: boolean;

  /**
   * Self-serve tenant registration: bcrypt hash of a one-time token sent by email.
   * Absent for legacy accounts and for users who never went through this flow.
   */
  @Prop({ type: String, select: false })
  emailVerifyTokenHash?: string;

  @Prop({ type: Date })
  emailVerifyExpiresAt?: Date;

  /** Platform operator; authoritative flag — not derived from `tenants`. */
  @Prop({ default: false, index: true })
  isPlatformAdmin: boolean;

  /** Optional display name set by the user or prefilled from an invite. */
  @Prop({ type: String, trim: true })
  displayName?: string;

  /**
   * Tenant-scoped role. Default 'admin' preserves access for all pre-existing registered users.
   * Not meaningful for platform admins (`isPlatformAdmin: true`).
   */
  @Prop({
    type: String,
    enum: ['admin', 'member'] satisfies TenantUserRole[],
    default: 'admin',
    index: true,
  })
  role: TenantUserRole;

  /**
   * Invited users start as inactive until they accept the invite and set a password.
   * Deactivated accounts cannot log in.
   */
  @Prop({ default: true })
  isActive: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index({ tenantId: 1, createdAt: -1 });
UserSchema.index({ email: 1 }, { unique: true });
