import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/guards/platform-admin.guard';
import { UpdateTenantDto } from '../tenant/dto/update-tenant.dto';
import {
  PLATFORM_ANALYTICS_DEFAULT_RANGE_DAYS,
  PlatformAnalyticsQueryDto,
} from './dto/platform-analytics-query.dto';
import { PlatformTenantListQueryDto } from './dto/platform-tenant-list-query.dto';
import { PlatformService } from './platform.service';
import { PlatformAnalyticsService } from './services/platform-analytics.service';

@ApiTags('Platform admin')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller('platform')
export class PlatformController {
  constructor(
    private readonly platformService: PlatformService,
    private readonly analyticsService: PlatformAnalyticsService,
  ) {}

  @Get('analytics')
  @ApiOperation({
    summary:
      'Aggregated platform analytics for graphing (live Mongo aggregations; MRR/ARR derived from active+trialing subs)',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 403, description: 'Not a platform administrator' })
  analytics(@Query() query: PlatformAnalyticsQueryDto) {
    return this.analyticsService.getAnalytics(
      query.days ?? PLATFORM_ANALYTICS_DEFAULT_RANGE_DAYS,
    );
  }

  @Get('overview')
  @ApiOperation({
    summary:
      'Active tenants, queued-for-TTL purge, and total users (platform operator)',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 403, description: 'Not a platform administrator' })
  overview() {
    return this.platformService.overview();
  }

  @Get('tenants')
  @ApiOperation({
    summary: 'List tenants (cross-tenant, platform operator)',
  })
  @ApiResponse({ status: 401 })
  @ApiResponse({ status: 403 })
  tenantList(@Query() query: PlatformTenantListQueryDto) {
    return this.platformService.listTenants(query);
  }

  @Get('tenants/:tenantId')
  @ApiParam({
    name: 'tenantId',
    description:
      'Organization id (Mongo ObjectId hex; same value as JWT `tenantId` for org users)',
  })
  @ApiOperation({
    summary: 'Get tenant by id (platform operator)',
  })
  @ApiResponse({ status: 404 })
  tenantById(@Param('tenantId') tenantId: string) {
    return this.platformService.getTenantByTenantId(tenantId);
  }

  @Patch('tenants/:tenantId')
  @ApiParam({ name: 'tenantId' })
  @ApiOperation({
    summary: 'Update tenant (active organizations only; not after soft delete)',
  })
  @ApiResponse({ status: 400 })
  @ApiResponse({ status: 404 })
  @ApiResponse({ status: 409, description: 'Tenant already soft-deleted' })
  updateTenant(
    @Param('tenantId') tenantId: string,
    @Body() body: UpdateTenantDto,
  ) {
    return this.platformService.updateTenant(tenantId, body);
  }

  @Delete('tenants/:tenantId')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'tenantId' })
  @ApiOperation({
    summary:
      'Soft-delete tenant (TTL hard-deletes document after retention window)',
  })
  @ApiResponse({ status: 404 })
  @ApiResponse({ status: 409, description: 'Already soft-deleted' })
  deleteTenant(@Param('tenantId') tenantId: string) {
    return this.platformService.softDeleteTenant(tenantId);
  }
}
