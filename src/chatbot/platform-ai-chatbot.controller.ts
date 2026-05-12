import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/guards/platform-admin.guard';
import { PlatformAiChatbotService } from './platform-ai-chatbot.service';

@ApiTags('Platform admin')
@Controller('platform/ai-chatbot')
export class PlatformAiChatbotController {
  constructor(private readonly platformAi: PlatformAiChatbotService) {}

  @Get('status')
  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'AI chatbot integration status (keys configured as booleans, no secrets)',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 403, description: 'Not a platform administrator' })
  getStatus() {
    return this.platformAi.getStatus();
  }
}
