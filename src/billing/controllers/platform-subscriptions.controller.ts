import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../auth/guards/platform-admin.guard';
import { PlatformSubscriptionListQueryDto } from '../dto/platform-subscription-list-query.dto';
import { PlatformSubscriptionMonitoringService } from '../services/platform-subscription-monitoring.service';

@ApiTags('Platform admin')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller('platform/subscriptions')
export class PlatformSubscriptionsController {
  constructor(
    private readonly monitoring: PlatformSubscriptionMonitoringService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'List tenant subscription rows (cross-tenant; Mongo billing state synced via Stripe webhooks)',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 403, description: 'Not a platform administrator' })
  list(@Query() query: PlatformSubscriptionListQueryDto) {
    return this.monitoring.list(query);
  }

  @Get(':tenantId')
  @ApiParam({
    name: 'tenantId',
    description:
      'Organization id (Mongo ObjectId hex; same value as JWT `tenantId` for org users)',
  })
  @ApiOperation({
    summary:
      'Subscription snapshot for one organization (includes `stripeCustomerId` and document timestamps for support)',
  })
  @ApiResponse({ status: 400, description: 'Invalid tenant id' })
  @ApiResponse({ status: 401 })
  @ApiResponse({ status: 403 })
  getOne(@Param('tenantId') tenantId: string) {
    return this.monitoring.getByTenantId(tenantId);
  }
}
