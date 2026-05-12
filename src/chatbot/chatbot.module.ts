import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { PlatformAiChatbotController } from './platform-ai-chatbot.controller';
import { PlatformAiChatbotService } from './platform-ai-chatbot.service';
import { ChatMessageRepository } from './repositories/chat-message.repository';
import { ChatSessionRepository } from './repositories/chat-session.repository';
import { ChatMessage, ChatMessageSchema } from './schemas/chat-message.schema';
import { ChatSession, ChatSessionSchema } from './schemas/chat-session.schema';
import { LlmRouterService } from './services/llm-router.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ChatSession.name, schema: ChatSessionSchema },
      { name: ChatMessage.name, schema: ChatMessageSchema },
    ]),
    AuthModule,
    BillingModule,
  ],
  controllers: [ChatbotController, PlatformAiChatbotController],
  providers: [
    ChatSessionRepository,
    ChatMessageRepository,
    LlmRouterService,
    ChatbotService,
    PlatformAiChatbotService,
  ],
  exports: [ChatbotService],
})
export class ChatbotModule {}
