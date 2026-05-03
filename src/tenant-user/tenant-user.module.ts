import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { TenantModule } from '../tenant/tenant.module';
import { UserModule } from '../user/user.module';
import { TenantUserInviteRepository } from './repositories/tenant-user-invite.repository';
import {
  TenantUserInvite,
  TenantUserInviteSchema,
} from './schemas/tenant-user-invite.schema';
import { TenantMeController } from './tenant-me.controller';
import { TenantUserController } from './tenant-user.controller';
import { TenantUserService } from './tenant-user.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TenantUserInvite.name, schema: TenantUserInviteSchema },
    ]),
    UserModule,
    AuthModule,
    BillingModule,
    TenantModule,
  ],
  controllers: [TenantUserController, TenantMeController],
  providers: [TenantUserService, TenantUserInviteRepository],
  exports: [TenantUserService],
})
export class TenantUserModule {}
