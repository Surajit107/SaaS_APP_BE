import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { isMongooseConnectionReady } from '../../common/mongoose/connection.util';
import { ChatSession, ChatSessionDocument } from '../schemas/chat-session.schema';

@Injectable()
export class ChatSessionRepository {
  constructor(
    @InjectModel(ChatSession.name) private readonly model: Model<ChatSession>,
  ) {}

  isMongooseReady(): boolean {
    return isMongooseConnectionReady(this.model.db);
  }

  async create(input: {
    tenantId: string;
    userId: string;
    title?: string;
  }): Promise<ChatSessionDocument> {
    const doc = new this.model({
      tenantId: input.tenantId,
      userId: input.userId,
      title: input.title?.trim() || 'New conversation',
    });
    return doc.save();
  }

  async findByIdForTenantUser(
    sessionId: string,
    tenantId: string,
    userId: string,
  ): Promise<ChatSessionDocument | null> {
    if (!Types.ObjectId.isValid(sessionId)) {
      return null;
    }
    return this.model
      .findOne({
        _id: new Types.ObjectId(sessionId),
        tenantId,
        userId,
      })
      .exec();
  }

  async listForTenantUser(
    tenantId: string,
    userId: string,
    limit: number,
  ): Promise<ChatSessionDocument[]> {
    const cap = Math.min(Math.max(limit, 1), 100);
    return this.model
      .find({ tenantId, userId })
      .sort({ updatedAt: -1 })
      .limit(cap)
      .exec();
  }

  async updateTitle(
    sessionId: string,
    tenantId: string,
    userId: string,
    title: string,
  ): Promise<ChatSessionDocument | null> {
    if (!Types.ObjectId.isValid(sessionId)) {
      return null;
    }
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      return this.findByIdForTenantUser(sessionId, tenantId, userId);
    }
    return this.model
      .findOneAndUpdate(
        { _id: new Types.ObjectId(sessionId), tenantId, userId },
        { $set: { title: trimmed.slice(0, 200) } },
        { returnDocument: 'after' },
      )
      .exec();
  }

  async deleteForTenantUser(
    sessionId: string,
    tenantId: string,
    userId: string,
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(sessionId)) {
      return false;
    }
    const res = await this.model
      .deleteOne({
        _id: new Types.ObjectId(sessionId),
        tenantId,
        userId,
      })
      .exec();
    return res.deletedCount === 1;
  }

  async bumpUpdatedAt(sessionId: string, tenantId: string, userId: string): Promise<void> {
    if (!Types.ObjectId.isValid(sessionId)) {
      return;
    }
    await this.model
      .updateOne(
        { _id: new Types.ObjectId(sessionId), tenantId, userId },
        { $set: { updatedAt: new Date() } },
      )
      .exec();
  }
}
