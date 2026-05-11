import {
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import type { AuthenticatedRequestUser } from '../auth/types/auth-request-user.types';
import { NotificationService } from './notification.service';

@ApiTags('Notification')
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get('status')
  @ApiOperation({ summary: 'Notification module health' })
  status() {
    return this.notificationService.getModuleStatus();
  }

  @Get('in-app')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiOperation({
    summary:
      'Recent in-app notifications (tenant admins: org-wide; members: their inbox only)',
  })
  listInApp(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Query('limit') limitRaw?: string,
  ) {
    const limit = Math.min(100, Math.max(1, Number(limitRaw ?? '30') || 30));
    return this.notificationService.listForCurrentUser(user, limit);
  }

  @Patch('in-app/:notificationId/read')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiParam({ name: 'notificationId', description: 'Mongo id of the notification' })
  @ApiOperation({ summary: 'Mark a single in-app notification as read' })
  markInAppRead(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('notificationId') notificationId: string,
  ) {
    return this.notificationService.markInAppRead(user, notificationId);
  }

  @Patch('in-app/read-all')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiOperation({
    summary:
      'Mark all in-app notifications as read (tenant admins: org-wide only; members: their inbox only)',
  })
  markAllInAppRead(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.notificationService.markAllInAppRead(user);
  }
}
