import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { TenantRepository } from './repositories/tenant.repository';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';
import { Tenant, TenantSchema } from './schemas/tenant.schema';
import { TenantStaleIndexCleanupService } from './tenant-stale-index-cleanup.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Tenant.name, schema: TenantSchema }]),
    forwardRef(() => AuthModule),
  ],
  controllers: [TenantController],
  providers: [TenantRepository, TenantService, TenantStaleIndexCleanupService],
  exports: [TenantService, TenantRepository],
})
export class TenantModule {}
