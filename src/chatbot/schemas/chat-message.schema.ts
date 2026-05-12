import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type ChatMessageRole = 'user' | 'assistant' | 'system';

export type ChatMessageDocument = HydratedDocument<ChatMessage>;

@Schema({ timestamps: true, collection: 'chat_messages' })
export class ChatMessage {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'ChatSession', required: true, index: true })
  sessionId: Types.ObjectId;

  @Prop({ required: true, index: true })
  tenantId: string;

  @Prop({ required: true, enum: ['user', 'assistant', 'system'] })
  role: ChatMessageRole;

  @Prop({ required: true })
  content: string;

  @Prop()
  provider?: string;

  @Prop()
  model?: string;
}

export const ChatMessageSchema = SchemaFactory.createForClass(ChatMessage);
ChatMessageSchema.index({ sessionId: 1, createdAt: 1 });
