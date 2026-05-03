import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type RefreshTokenDocument = HydratedDocument<RefreshToken>;

@Schema({ timestamps: true, collection: 'refresh_tokens' })
export class RefreshToken {
  @Prop({ required: true, unique: true, index: true })
  jti: string;

  @Prop({ type: Types.ObjectId, required: true, ref: 'User', index: true })
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

  @Prop({ required: true })
  secretHash: string;

  @Prop({ required: true, index: true })
  familyId: string;

  /** TTL: MongoDB removes the row shortly after this instant (TTL monitor cadence applies). */
  @Prop({ required: true })
  expiresAt: Date;
}

export const RefreshTokenSchema = SchemaFactory.createForClass(RefreshToken);
RefreshTokenSchema.index({ userId: 1, tenantId: 1 });
/** Deletes document after `expiresAt` passes (`expireAfterSeconds: 0` = at that date threshold). */
RefreshTokenSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: 'refresh_tokens_expiresAt_ttl' },
);
