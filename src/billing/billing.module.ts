import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../user/user.module';
import { BillingController } from './billing.controller';
import { BillingStripeWebhookController } from './controllers/billing-stripe-webhook.controller';
import { BillingTenantController } from './controllers/billing-tenant.controller';
import { PlatformSubscriptionPlansController } from './controllers/platform-subscription-plans.controller';
import { PlatformSubscriptionsController } from './controllers/platform-subscriptions.controller';
import { BillingService } from './billing.service';
import { StripeWebhookEventRepository } from './repositories/stripe-webhook-event.repository';
import { SubscriptionPlanRepository } from './repositories/subscription-plan.repository';
import { SubscriptionRepository } from './repositories/subscription.repository';
import {
  StripeWebhookEvent,
  StripeWebhookEventSchema,
} from './schemas/stripe-webhook-event.schema';
import {
  SubscriptionPlan,
  SubscriptionPlanSchema,
} from './schemas/subscription-plan.schema';
import {
  Subscription,
  SubscriptionSchema,
} from './schemas/subscription.schema';
import { StripeClientService } from './services/stripe-client.service';
import { StripeWebhookService } from './services/stripe-webhook.service';
import { PlatformSubscriptionMonitoringService } from './services/platform-subscription-monitoring.service';
import { SubscriptionEntitlementsService } from './services/subscription-entitlements.service';
import { SubscriptionPlanAdminService } from './services/subscription-plan-admin.service';
import { TenantBillingService } from './services/tenant-billing.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: SubscriptionPlan.name, schema: SubscriptionPlanSchema },
      { name: StripeWebhookEvent.name, schema: StripeWebhookEventSchema },
    ]),
    AuthModule,
    UserModule,
  ],
  controllers: [
    BillingController,
    BillingTenantController,
    BillingStripeWebhookController,
    PlatformSubscriptionPlansController,
    PlatformSubscriptionsController,
  ],
  providers: [
    SubscriptionRepository,
    SubscriptionPlanRepository,
    StripeWebhookEventRepository,
    StripeClientService,
    SubscriptionPlanAdminService,
    PlatformSubscriptionMonitoringService,
    TenantBillingService,
    StripeWebhookService,
    BillingService,
    SubscriptionEntitlementsService,
  ],
  exports: [
    BillingService,
    SubscriptionPlanAdminService,
    TenantBillingService,
    StripeClientService,
    SubscriptionEntitlementsService,
  ],
})
export class BillingModule {}
