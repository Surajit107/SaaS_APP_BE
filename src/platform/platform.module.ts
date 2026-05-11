import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { TenantModule } from '../tenant/tenant.module';
import { UserModule } from '../user/user.module';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { PlatformAnalyticsService } from './services/platform-analytics.service';

@Module({
  imports: [UserModule, AuthModule, TenantModule, BillingModule],
  controllers: [PlatformController],
  providers: [PlatformService, PlatformAnalyticsService],
})
export class PlatformModule {}
