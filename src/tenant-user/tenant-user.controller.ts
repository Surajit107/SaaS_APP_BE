import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
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
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAdminGuard } from '../auth/guards/tenant-admin.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import type { AuthenticatedRequestUser } from '../auth/types/auth-request-user.types';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { CreateTenantUserDto } from './dto/create-tenant-user.dto';
import { ListTenantUsersQueryDto } from './dto/list-tenant-users.query.dto';
import { UpdateTenantUserDto } from './dto/update-tenant-user.dto';
import { TenantUserService } from './tenant-user.service';

@ApiTags('Tenant Users')
@Controller('tenant/users')
export class TenantUserController {
  constructor(private readonly tenantUserService: TenantUserService) {}

  // ─── Public ──────────────────────────────────────────────────────────────

  @Post('accept-invite')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept an email invitation and set a password',
    description:
      'Public endpoint. The invited user submits the token from their invitation email along with a chosen password. On success the account is activated and the user can log in via POST /auth/login.',
  })
  @ApiResponse({ status: 200, description: 'Account activated — user may now log in' })
  @ApiResponse({ status: 401, description: 'Invalid or expired invitation token' })
  acceptInvite(@Body() body: AcceptInviteDto) {
    return this.tenantUserService.acceptInvite(body);
  }

  // ─── Tenant-admin protected ───────────────────────────────────────────────

  @Get()
  @UseGuards(JwtAuthGuard, TenantGuard, TenantAdminGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'List all users in the current tenant (paginated)',
    description:
      'Returns only users belonging to the tenant derived from the JWT. Platform admins and cross-tenant data are never exposed.',
  })
  listUsers(
    @CurrentUser() user: AuthenticatedRequestUser | undefined,
    @Query() query: ListTenantUsersQueryDto,
  ) {
    if (!user) throw new UnauthorizedException();
    return this.tenantUserService.listUsers(user.tenantId, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, TenantGuard, TenantAdminGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Invite a new user to the tenant',
    description:
      'Creates a pending user account and sends an invitation email. The invited user must click the link in the email to set a password before they can log in.',
  })
  @ApiResponse({ status: 201, description: 'Invitation sent' })
  @ApiResponse({ status: 409, description: 'Email already in use' })
  inviteUser(
    @CurrentUser() user: AuthenticatedRequestUser | undefined,
    @Body() body: CreateTenantUserDto,
  ) {
    if (!user) throw new UnauthorizedException();
    return this.tenantUserService.inviteUser(user, body);
  }

  @Get(':userId')
  @UseGuards(JwtAuthGuard, TenantGuard, TenantAdminGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get a user by ID (must belong to the current tenant)' })
  @ApiParam({ name: 'userId', description: 'MongoDB ObjectId of the user' })
  @ApiResponse({ status: 404, description: 'User not found' })
  getUserById(
    @CurrentUser() user: AuthenticatedRequestUser | undefined,
    @Param('userId') userId: string,
  ) {
    if (!user) throw new UnauthorizedException();
    return this.tenantUserService.getUserById(user.tenantId, userId);
  }

  @Patch(':userId')
  @UseGuards(JwtAuthGuard, TenantGuard, TenantAdminGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: "Update a tenant user's display name, role, or active status",
  })
  @ApiParam({ name: 'userId', description: 'MongoDB ObjectId of the user' })
  @ApiResponse({ status: 404, description: 'User not found' })
  updateUser(
    @CurrentUser() user: AuthenticatedRequestUser | undefined,
    @Param('userId') userId: string,
    @Body() body: UpdateTenantUserDto,
  ) {
    if (!user) throw new UnauthorizedException();
    return this.tenantUserService.updateUser(user.tenantId, userId, body);
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, TenantGuard, TenantAdminGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Permanently delete a user from the tenant',
    description:
      'Hard-deletes the user record. Any pending invite for this user is also removed. Admins cannot delete their own account.',
  })
  @ApiParam({ name: 'userId', description: 'MongoDB ObjectId of the user' })
  @ApiResponse({ status: 403, description: 'Cannot delete your own account' })
  @ApiResponse({ status: 404, description: 'User not found' })
  deleteUser(
    @CurrentUser() user: AuthenticatedRequestUser | undefined,
    @Param('userId') userId: string,
  ) {
    if (!user) throw new UnauthorizedException();
    return this.tenantUserService.deleteUser(user.tenantId, userId, user.userId);
  }
}
