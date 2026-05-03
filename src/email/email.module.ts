import { Module } from '@nestjs/common';
import { UserModule } from '../user/user.module';
import { EmailService } from './email.service';
import { BillingSubscriptionEmailListener } from './listeners/billing-subscription-email.listener';
import { TenantRegisteredEmailListener } from './listeners/tenant-registered-email.listener';
import { TenantUserInviteEmailListener } from './listeners/tenant-user-invite-email.listener';

@Module({
  imports: [UserModule],
  providers: [
    EmailService,
    TenantRegisteredEmailListener,
    BillingSubscriptionEmailListener,
    TenantUserInviteEmailListener,
  ],
  exports: [EmailService],
})
export class EmailModule {}
