import {
  Body,
  Controller,
  ForbiddenException,
  Patch,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import type { AuthenticatedRequestUser } from '../auth/types/auth-request-user.types';
import { UpdateTenantMeDto } from './dto/update-tenant-me.dto';
import { TenantUserService } from './tenant-user.service';

@ApiTags('Tenant profile')
@Controller('tenant')
export class TenantMeController {
  constructor(private readonly tenantUserService: TenantUserService) {}

  @Patch('me')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Update current tenant user profile',
    description:
      'Updates the authenticated user document in the current tenant (from JWT). Platform admins must use other flows.',
  })
  @ApiResponse({ status: 400, description: 'Invalid body' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 403, description: 'No tenant context or platform account' })
  @ApiResponse({ status: 404, description: 'User record not found' })
  patchMe(
    @CurrentUser() user: AuthenticatedRequestUser | undefined,
    @Body() body: UpdateTenantMeDto,
  ) {
    if (!user) {
      throw new UnauthorizedException();
    }
    if (user.platformAdmin) {
      throw new ForbiddenException('Platform accounts cannot use tenant profile endpoints');
    }
    return this.tenantUserService.patchCurrentUserMe(user, body);
  }
}
