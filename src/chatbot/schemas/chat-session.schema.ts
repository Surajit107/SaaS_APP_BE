import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ChatSessionDocument = HydratedDocument<ChatSession>;

@Schema({ timestamps: true, collection: 'chat_sessions' })
export class ChatSession {
  @Prop({ required: true, index: true })
  tenantId: string;

  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ default: 'New conversation' })
  title: string;
}

export const ChatSessionSchema = SchemaFactory.createForClass(ChatSession);
ChatSessionSchema.index({ tenantId: 1, userId: 1, updatedAt: -1 });
