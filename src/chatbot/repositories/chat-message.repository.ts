import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { isMongooseConnectionReady } from '../../common/mongoose/connection.util';
import {
  ChatMessage,
  ChatMessageDocument,
  ChatMessageRole,
} from '../schemas/chat-message.schema';

@Injectable()
export class ChatMessageRepository {
  constructor(
    @InjectModel(ChatMessage.name) private readonly model: Model<ChatMessage>,
  ) {}

  isMongooseReady(): boolean {
    return isMongooseConnectionReady(this.model.db);
  }

  async create(input: {
    sessionId: Types.ObjectId;
    tenantId: string;
    role: ChatMessageRole;
    content: string;
    provider?: string;
    model?: string;
  }): Promise<ChatMessageDocument> {
    const doc = new this.model({
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      role: input.role,
      content: input.content,
      provider: input.provider,
      model: input.model,
    });
    return doc.save();
  }

  async listBySessionForTenant(
    sessionId: string,
    tenantId: string,
    limit: number,
  ): Promise<ChatMessageDocument[]> {
    if (!Types.ObjectId.isValid(sessionId)) {
      return [];
    }
    const cap = Math.min(Math.max(limit, 1), 200);
    return this.model
      .find({
        sessionId: new Types.ObjectId(sessionId),
        tenantId,
      })
      .sort({ createdAt: 1 })
      .limit(cap)
      .exec();
  }

  async deleteBySessionForTenant(sessionId: string, tenantId: string): Promise<void> {
    if (!Types.ObjectId.isValid(sessionId)) {
      return;
    }
    await this.model
      .deleteMany({
        sessionId: new Types.ObjectId(sessionId),
        tenantId,
      })
      .exec();
  }
}
