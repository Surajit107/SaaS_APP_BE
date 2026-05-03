import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantModule } from '../tenant/tenant.module';
import { UserModule } from '../user/user.module';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

@Module({
  imports: [UserModule, AuthModule, TenantModule],
  controllers: [PlatformController],
  providers: [PlatformService],
})
export class PlatformModule {}
