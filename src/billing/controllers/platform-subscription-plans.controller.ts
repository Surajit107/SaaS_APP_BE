import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../auth/guards/platform-admin.guard';
import { CreateSubscriptionPlanDto } from '../dto/create-subscription-plan.dto';
import { UpdateSubscriptionPlanDto } from '../dto/update-subscription-plan.dto';
import { SubscriptionPlanAdminService } from '../services/subscription-plan-admin.service';

@ApiTags('Platform admin')
@Controller('platform/subscription-plans')
export class PlatformSubscriptionPlansController {
  constructor(
    private readonly subscriptionPlanAdmin: SubscriptionPlanAdminService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Create catalog plan (Stripe Product + Price + Mongo record). Platform operator only.',
  })
  @ApiBody({ type: CreateSubscriptionPlanDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 403, description: 'Not a platform administrator' })
  @ApiResponse({
    status: 201,
    description: 'Plan created; `data.id` is the Mongo catalog document id',
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed (whitelist / invalid body)',
  })
  create(@Body() body: CreateSubscriptionPlanDto) {
    return this.subscriptionPlanAdmin.create(body);
  }

  @Get()
  @ApiOperation({
    summary:
      'List active subscription plans (public). Omits `stripeProductId` and archived plans.',
  })
  @ApiResponse({ status: 200, description: 'Catalog plans (newest first)' })
  list() {
    return this.subscriptionPlanAdmin.list(false, false);
  }

  @Get(':planId')
  @ApiParam({
    name: 'planId',
    description: 'Subscription plan document id (Mongo ObjectId hex)',
  })
  @ApiOperation({
    summary:
      'Get subscription plan by id (public). Archived plans return 404. Omits `stripeProductId`.',
  })
  @ApiResponse({
    status: 404,
    description: 'Plan not found or archived',
  })
  getOne(@Param('planId') planId: string) {
    return this.subscriptionPlanAdmin.getById(planId, false);
  }

  @Patch(':planId')
  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @ApiBearerAuth('access-token')
  @ApiParam({
    name: 'planId',
    description: 'Subscription plan document id (Mongo ObjectId hex)',
  })
  @ApiOperation({
    summary:
      'Update mutable plan metadata only (name, trial settings, features). Pricing changes require creating a new plan version.',
  })
  @ApiBody({ type: UpdateSubscriptionPlanDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 403, description: 'Not a platform administrator' })
  @ApiResponse({ status: 404, description: 'Plan not found' })
  @ApiResponse({
    status: 409,
    description: 'Plan is archived and cannot be updated',
  })
  @ApiResponse({
    status: 400,
    description:
      'No valid fields, pricing/interval update attempt, `archived` in body (use DELETE instead), or validation error',
  })
  update(
    @Param('planId') planId: string,
    @Body() body: UpdateSubscriptionPlanDto,
  ) {
    return this.subscriptionPlanAdmin.update(planId, body);
  }

  @Delete(':planId')
  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiParam({
    name: 'planId',
    description: 'Subscription plan document id (Mongo ObjectId hex)',
  })
  @ApiOperation({
    summary:
      'Archive plan (deactivate Stripe product/price; keeps historical webhook linkage)',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 403, description: 'Not a platform administrator' })
  @ApiResponse({ status: 404, description: 'Plan not found' })
  @ApiResponse({
    status: 400,
    description: 'Plan already archived',
  })
  archive(@Param('planId') planId: string) {
    return this.subscriptionPlanAdmin.archive(planId);
  }
}
