import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../auth/guards/tenant.guard';
import type { AuthenticatedRequestUser } from '../../auth/types/auth-request-user.types';
import { CancelSubscriptionDto } from '../dto/cancel-subscription.dto';
import { ConfirmCheckoutSessionDto } from '../dto/confirm-checkout-session.dto';
import { CreateCheckoutSessionDto } from '../dto/create-checkout-session.dto';
import { RequestRefundDto } from '../dto/request-refund.dto';
import { TenantBillingService } from '../services/tenant-billing.service';

@ApiTags('Billing')
@Controller('billing')
export class BillingTenantController {
  constructor(private readonly tenantBilling: TenantBillingService) {}

  @Get('plans')
  @ApiOperation({ summary: 'Public catalog of sellable plans' })
  listPlans() {
    return this.tenantBilling.listPublicPlans();
  }

  @Get('plans/:planId')
  @ApiParam({
    name: 'planId',
    description: 'Subscription plan document id (Mongo ObjectId hex)',
  })
  @ApiOperation({ summary: 'Public detail for one sellable plan' })
  getPlan(@Param('planId') planId: string) {
    return this.tenantBilling.getPublicPlanById(planId);
  }

  @Get('subscription')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiOperation({
    summary: 'Current tenant subscription snapshot (Mongo + Stripe ids)',
  })
  current(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.tenantBilling.getTenantSubscription(user.tenantId);
  }

  @Post('checkout-session')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiOperation({
    summary:
      'Start Stripe Checkout for this tenant (requires Customer + line item price id)',
  })
  checkout(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Body() body: CreateCheckoutSessionDto,
  ) {
    return this.tenantBilling.createCheckoutSession(user, body);
  }

  @Post('checkout-success')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiOperation({
    summary: 'Confirm Stripe checkout session and sync tenant subscription state',
  })
  checkoutSuccess(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Body() body: ConfirmCheckoutSessionDto,
  ) {
    return this.tenantBilling.confirmCheckoutSession(user, body.sessionId);
  }

  @Post('portal-session')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiOperation({ summary: 'Create Stripe Customer Billing Portal session' })
  portal(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.tenantBilling.createBillingPortalSession(user);
  }

  @Post('subscription/cancel')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiOperation({
    summary:
      'Cancel tenant subscription now or schedule cancellation at period end',
  })
  cancel(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Body() body: CancelSubscriptionDto,
  ) {
    return this.tenantBilling.cancelSubscription(user, body);
  }

  @Post('subscription/refund')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiOperation({
    summary:
      'Request refund against latest paid invoice charge for active tenant subscription',
  })
  requestRefund(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Body() body: RequestRefundDto,
  ) {
    return this.tenantBilling.requestRefund(user, body);
  }
}
