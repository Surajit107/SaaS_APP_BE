import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ChatMessageDocument } from './schemas/chat-message.schema';
import type { ChatSessionDocument } from './schemas/chat-session.schema';
import { Types } from 'mongoose';
import type { ApiSuccessResponse } from '../common/types/api-response.types';
import type { AuthenticatedRequestUser } from '../auth/types/auth-request-user.types';
import { SubscriptionEntitlementsService } from '../billing/services/subscription-entitlements.service';
import { CreateChatSessionDto } from './dto/create-chat-session.dto';
import { PatchChatSessionDto } from './dto/patch-chat-session.dto';
import { SendChatMessageDto } from './dto/send-chat-message.dto';
import { ChatMessageRepository } from './repositories/chat-message.repository';
import { ChatSessionRepository } from './repositories/chat-session.repository';
import type { ChatLlmMessage } from './types/chat-llm.types';
import { LlmRouterService } from './services/llm-router.service';

const DEFAULT_SYSTEM_PROMPT =
  'You are a concise, professional assistant for an authenticated B2B SaaS tenant user. ' +
  'Do not invent product features or pricing. If asked for secrets or internal system details, refuse.';

export type ChatSessionPublic = {
  id: string;
  tenantId: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type ChatMessagePublic = {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  provider?: string;
  model?: string;
  createdAt: string;
};

@Injectable()
export class ChatbotService {
  constructor(
    private readonly entitlements: SubscriptionEntitlementsService,
    private readonly sessions: ChatSessionRepository,
    private readonly messages: ChatMessageRepository,
    private readonly llm: LlmRouterService,
    private readonly config: ConfigService,
  ) {}

  getModuleStatus(): ApiSuccessResponse<{
    module: string;
    dbReady: boolean;
  }> {
    return {
      success: true,
      message: 'Chatbot module ready',
      data: {
        module: 'chatbot',
        dbReady: this.sessions.isMongooseReady() && this.messages.isMongooseReady(),
      },
    };
  }

  async getEligibility(
    user: AuthenticatedRequestUser,
  ): Promise<ApiSuccessResponse<{ allowed: boolean; reason?: string }>> {
    if (!user.tenantId) {
      return {
        success: true,
        message: 'OK',
        data: { allowed: false, reason: 'no_tenant' },
      };
    }
    const allowed = await this.entitlements.resolveAiChatbotAccess(user.tenantId);
    return {
      success: true,
      message: 'OK',
      data: allowed
        ? { allowed: true }
        : {
            allowed: false,
            reason: 'plan',
          },
    };
  }

  async createSession(
    user: AuthenticatedRequestUser,
    dto: CreateChatSessionDto,
  ): Promise<ApiSuccessResponse<ChatSessionPublic>> {
    if (!user.tenantId) {
      throw new UnauthorizedException();
    }
    await this.entitlements.assertTenantHasAiChatbotAccess(user.tenantId);
    const created = await this.sessions.create({
      tenantId: user.tenantId,
      userId: user.userId,
      title: dto.title,
    });
    return {
      success: true,
      message: 'Session created',
      data: this.toSessionPublic(created),
    };
  }

  async listSessions(
    user: AuthenticatedRequestUser,
    limit = 30,
  ): Promise<ApiSuccessResponse<ChatSessionPublic[]>> {
    if (!user.tenantId) {
      throw new UnauthorizedException();
    }
    await this.entitlements.assertTenantHasAiChatbotAccess(user.tenantId);
    const rows = await this.sessions.listForTenantUser(user.tenantId, user.userId, limit);
    return {
      success: true,
      message: 'OK',
      data: rows.map((r: ChatSessionDocument) => this.toSessionPublic(r)),
    };
  }

  async patchSession(
    user: AuthenticatedRequestUser,
    sessionId: string,
    dto: PatchChatSessionDto,
  ): Promise<ApiSuccessResponse<ChatSessionPublic>> {
    if (!user.tenantId) {
      throw new UnauthorizedException();
    }
    await this.entitlements.assertTenantHasAiChatbotAccess(user.tenantId);
    if (dto.title === undefined) {
      throw new BadRequestException('No valid fields to update');
    }
    const updated = await this.sessions.updateTitle(
      sessionId,
      user.tenantId,
      user.userId,
      dto.title,
    );
    if (!updated) {
      throw new NotFoundException('Chat session not found');
    }
    return {
      success: true,
      message: 'Session updated',
      data: this.toSessionPublic(updated),
    };
  }

  async deleteSession(user: AuthenticatedRequestUser, sessionId: string): Promise<ApiSuccessResponse<null>> {
    if (!user.tenantId) {
      throw new UnauthorizedException();
    }
    await this.entitlements.assertTenantHasAiChatbotAccess(user.tenantId);
    await this.messages.deleteBySessionForTenant(sessionId, user.tenantId);
    const ok = await this.sessions.deleteForTenantUser(sessionId, user.tenantId, user.userId);
    if (!ok) {
      throw new NotFoundException('Chat session not found');
    }
    return { success: true, message: 'Session deleted', data: null };
  }

  async listMessages(
    user: AuthenticatedRequestUser,
    sessionId: string,
    limit = 100,
  ): Promise<ApiSuccessResponse<ChatMessagePublic[]>> {
    if (!user.tenantId) {
      throw new UnauthorizedException();
    }
    await this.entitlements.assertTenantHasAiChatbotAccess(user.tenantId);
    const session = await this.sessions.findByIdForTenantUser(sessionId, user.tenantId, user.userId);
    if (!session) {
      throw new NotFoundException('Chat session not found');
    }
    const rows = await this.messages.listBySessionForTenant(sessionId, user.tenantId, limit);
    return {
      success: true,
      message: 'OK',
      data: rows.map((m: ChatMessageDocument) => this.toMessagePublic(m)),
    };
  }

  async sendMessage(
    user: AuthenticatedRequestUser,
    sessionId: string,
    dto: SendChatMessageDto,
  ): Promise<ApiSuccessResponse<{ assistantMessage: ChatMessagePublic }>> {
    if (!user.tenantId) {
      throw new UnauthorizedException();
    }
    await this.entitlements.assertTenantHasAiChatbotAccess(user.tenantId);
    const session = await this.sessions.findByIdForTenantUser(sessionId, user.tenantId, user.userId);
    if (!session) {
      throw new NotFoundException('Chat session not found');
    }

    const content = dto.content.trim();
    if (content.length === 0) {
      throw new BadRequestException('Message cannot be empty');
    }

    const sessionOid = session._id as Types.ObjectId;

    await this.messages.create({
      sessionId: sessionOid,
      tenantId: user.tenantId,
      role: 'user',
      content,
    });

    const defaultTitle = 'New conversation';
    if (session.title === defaultTitle && content.length > 0) {
      await this.sessions.updateTitle(
        sessionId,
        user.tenantId,
        user.userId,
        content.slice(0, 80),
      );
    }

    const history = await this.messages.listBySessionForTenant(sessionId, user.tenantId, 60);
    const systemPrompt =
      this.config.get<string>('CHATBOT_SYSTEM_PROMPT')?.trim() || DEFAULT_SYSTEM_PROMPT;

    const llmMessages: ChatLlmMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history.map((m: ChatMessageDocument): ChatLlmMessage => {
        if (m.role === 'assistant') {
          return { role: 'assistant', content: m.content };
        }
        if (m.role === 'system') {
          return { role: 'system', content: m.content };
        }
        return { role: 'user', content: m.content };
      }),
    ];

    const completion = await this.llm.complete(llmMessages);

    const assistantDoc = await this.messages.create({
      sessionId: sessionOid,
      tenantId: user.tenantId,
      role: 'assistant',
      content: completion.text,
      provider: completion.provider,
      model: completion.model,
    });

    await this.sessions.bumpUpdatedAt(sessionId, user.tenantId, user.userId);

    return {
      success: true,
      message: 'OK',
      data: { assistantMessage: this.toMessagePublic(assistantDoc) },
    };
  }

  private toSessionPublic(doc: {
    _id: Types.ObjectId;
    tenantId: string;
    userId: string;
    title: string;
    createdAt?: Date;
    updatedAt?: Date;
  }): ChatSessionPublic {
    return {
      id: String(doc._id),
      tenantId: doc.tenantId,
      userId: doc.userId,
      title: doc.title,
      createdAt: (doc.createdAt ?? new Date(0)).toISOString(),
      updatedAt: (doc.updatedAt ?? new Date(0)).toISOString(),
    };
  }

  private toMessagePublic(doc: {
    _id: Types.ObjectId;
    sessionId: Types.ObjectId;
    role: 'user' | 'assistant' | 'system';
    content: string;
    provider?: string;
    model?: string;
    createdAt?: Date;
  }): ChatMessagePublic {
    return {
      id: String(doc._id),
      sessionId: String(doc.sessionId),
      role: doc.role,
      content: doc.content,
      provider: doc.provider,
      model: doc.model,
      createdAt: (doc.createdAt ?? new Date(0)).toISOString(),
    };
  }
}
