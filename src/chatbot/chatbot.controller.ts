import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import type { AuthenticatedRequestUser } from '../auth/types/auth-request-user.types';
import { ChatbotService } from './chatbot.service';
import { CreateChatSessionDto } from './dto/create-chat-session.dto';
import { PatchChatSessionDto } from './dto/patch-chat-session.dto';
import { SendChatMessageDto } from './dto/send-chat-message.dto';

@ApiTags('Chatbot')
@Controller('chat')
export class ChatbotController {
  constructor(private readonly chatbotService: ChatbotService) {}

  @Get('status')
  @ApiOperation({ summary: 'Chatbot module health' })
  getStatus() {
    return this.chatbotService.getModuleStatus();
  }

  @Get('eligibility')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Whether the current tenant may use the AI assistant' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  getEligibility(@CurrentUser() user: AuthenticatedRequestUser | undefined) {
    if (!user) {
      throw new UnauthorizedException();
    }
    return this.chatbotService.getEligibility(user);
  }

  @Post('sessions')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Create a chat session' })
  createSession(
    @CurrentUser() user: AuthenticatedRequestUser | undefined,
    @Body() body: CreateChatSessionDto,
  ) {
    if (!user) {
      throw new UnauthorizedException();
    }
    return this.chatbotService.createSession(user, body);
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'List chat sessions for the current user' })
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', default: 30 } })
  listSessions(
    @CurrentUser() user: AuthenticatedRequestUser | undefined,
    @Query('limit') limit?: string,
  ) {
    if (!user) {
      throw new UnauthorizedException();
    }
    const n = limit !== undefined ? Number(limit) : 30;
    return this.chatbotService.listSessions(user, Number.isFinite(n) ? n : 30);
  }

  @Patch('sessions/:sessionId')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth('access-token')
  @ApiParam({ name: 'sessionId', description: 'Chat session id' })
  @ApiOperation({ summary: 'Update chat session metadata (title)' })
  patchSession(
    @CurrentUser() user: AuthenticatedRequestUser | undefined,
    @Param('sessionId') sessionId: string,
    @Body() body: PatchChatSessionDto,
  ) {
    if (!user) {
      throw new UnauthorizedException();
    }
    return this.chatbotService.patchSession(user, sessionId, body);
  }

  @Delete('sessions/:sessionId')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth('access-token')
  @ApiParam({ name: 'sessionId', description: 'Chat session id' })
  @ApiOperation({ summary: 'Delete a chat session and its messages' })
  deleteSession(
    @CurrentUser() user: AuthenticatedRequestUser | undefined,
    @Param('sessionId') sessionId: string,
  ) {
    if (!user) {
      throw new UnauthorizedException();
    }
    return this.chatbotService.deleteSession(user, sessionId);
  }

  @Get('sessions/:sessionId/messages')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth('access-token')
  @ApiParam({ name: 'sessionId', description: 'Chat session id' })
  @ApiOperation({ summary: 'List messages in a session' })
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', default: 100 } })
  listMessages(
    @CurrentUser() user: AuthenticatedRequestUser | undefined,
    @Param('sessionId') sessionId: string,
    @Query('limit') limit?: string,
  ) {
    if (!user) {
      throw new UnauthorizedException();
    }
    const n = limit !== undefined ? Number(limit) : 100;
    return this.chatbotService.listMessages(user, sessionId, Number.isFinite(n) ? n : 100);
  }

  @Post('sessions/:sessionId/messages')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth('access-token')
  @ApiParam({ name: 'sessionId', description: 'Chat session id' })
  @ApiOperation({ summary: 'Send a user message; returns the assistant reply' })
  sendMessage(
    @CurrentUser() user: AuthenticatedRequestUser | undefined,
    @Param('sessionId') sessionId: string,
    @Body() body: SendChatMessageDto,
  ) {
    if (!user) {
      throw new UnauthorizedException();
    }
    return this.chatbotService.sendMessage(user, sessionId, body);
  }
}
