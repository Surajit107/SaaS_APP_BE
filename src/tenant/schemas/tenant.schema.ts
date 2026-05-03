import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type TenantDocument = HydratedDocument<Tenant>;

@Schema({ timestamps: true, collection: 'tenants' })
export class Tenant {
  /** Self-referential tenant root; use a sentinel or same id for org tenant document. */
  @Prop({ required: true, index: true })
  tenantId: string;

  @Prop({ required: true })
  name: string;

  @Prop({ default: true })
  isActive: boolean;

  /** Set when platform (or process) soft-deletes the org; unset/null means active. */
  @Prop({ type: Date, default: null })
  deletedAt: Date | null;

  /**
   * Expiry time for MongoDB TTL removal. Only set after soft delete; omitted on active tenants so sparse TTL index ignores the document.
   */
  @Prop({ type: Date })
  purgeAt?: Date;
}

export const TenantSchema = SchemaFactory.createForClass(Tenant);
TenantSchema.index({ tenantId: 1, createdAt: -1 });
/** Hard-delete document when `purgeAt` passes (soft delete + retention window). */
TenantSchema.index(
  { purgeAt: 1 },
  { expireAfterSeconds: 0, sparse: true, name: 'tenants_purgeAt_ttl' },
);
