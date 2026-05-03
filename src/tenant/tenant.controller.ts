import {
  Body,
  Controller,
  Get,
  Patch,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { AuthenticatedRequestUser } from '../auth/types/auth-request-user.types';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { TenantService } from './tenant.service';

@ApiTags('Tenant')
@Controller('tenants')
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Get('status')
  @ApiOperation({ summary: 'Tenant module health' })
  status() {
    return this.tenantService.getModuleStatus();
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Update current organization (tenant)',
    description:
      'Scoped to JWT `tenantId`. Send at least one of `name`, `isActive`.',
  })
  @ApiResponse({ status: 400, description: 'Empty body or invalid payload' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 403, description: 'Token has no tenant context' })
  @ApiResponse({ status: 404, description: 'Tenant record missing' })
  updateCurrent(
    @CurrentUser() user: AuthenticatedRequestUser | undefined,
    @Body() body: UpdateTenantDto,
  ) {
    if (!user) {
      throw new UnauthorizedException();
    }
    return this.tenantService.updateCurrentTenant(user.tenantId, body);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get current organization (tenant) details',
    description: 'Scoped to JWT `tenantId`.',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 403, description: 'Token has no tenant context' })
  @ApiResponse({ status: 404, description: 'Tenant record missing' })
  me(@CurrentUser() user: AuthenticatedRequestUser | undefined) {
    if (!user) {
      throw new UnauthorizedException();
    }
    return this.tenantService.getCurrentTenant(user.tenantId);
  }
}
