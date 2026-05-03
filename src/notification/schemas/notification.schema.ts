import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type NotificationDocument = HydratedDocument<Notification>;

@Schema({ timestamps: true, collection: 'notifications' })
export class Notification {
  @Prop({ required: true, index: true })
  tenantId: string;

  /**
   * When set, only that user (and tenant admins listing all) should see this row.
   * Omitted for org-wide alerts (e.g. billing) visible to admins only via list rules.
   */
  @Prop({ type: String, index: true })
  recipientUserId?: string;

  @Prop({ default: 'in_app' })
  channel: string;

  /**
   * Legacy rows used `pending`; new in-app notifications use `unread` / `read`.
   */
  @Prop({ default: 'unread' })
  status: string;

  @Prop({ default: 'general' })
  type: string;

  @Prop({ default: '' })
  title: string;

  @Prop()
  body?: string;

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);
NotificationSchema.index({ tenantId: 1, createdAt: -1 });
NotificationSchema.index({ tenantId: 1, recipientUserId: 1, createdAt: -1 });
