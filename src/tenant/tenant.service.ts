import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ClientSession } from 'mongoose';
import type { ApiSuccessResponse } from '../common/types/api-response.types';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import {
  CreateTenantRecordInput,
  TenantRepository,
} from './repositories/tenant.repository';
import { toTenantPublic } from './mappers/tenant-public.mapper';
import { TenantDocument } from './schemas/tenant.schema';
import type { TenantPublic } from './types/tenant-public.types';

@Injectable()
export class TenantService {
  constructor(private readonly tenantRepository: TenantRepository) {}

  getModuleStatus(): ApiSuccessResponse<{
    module: string;
    dbReady: boolean;
  }> {
    return {
      success: true,
      message: 'Tenant module ready',
      data: {
        module: 'tenant',
        dbReady: this.tenantRepository.isMongooseReady(),
      },
    };
  }

  create(
    dto: CreateTenantDto,
    session?: ClientSession,
  ): Promise<TenantDocument> {
    const input: CreateTenantRecordInput = {
      name: dto.name,
      isActive: dto.isActive,
    };
    return this.tenantRepository.create(input, session);
  }

  /**
   * Compensating delete when a subsequent step (e.g. first user) fails after tenant insert.
   */
  deleteById(tenantId: string, session?: ClientSession): Promise<void> {
    return this.tenantRepository.deleteById(tenantId, session);
  }

  isDatabaseReady(): boolean {
    return this.tenantRepository.isMongooseReady();
  }

  /**
   * Blocks auth (login/refresh/token issue) when tenant is soft-deleted or missing.
   */
  async assertTenantActiveForAuth(tenantId: string): Promise<void> {
    const tenant = await this.tenantRepository.findActiveByTenantId(tenantId);
    if (!tenant) {
      throw new UnauthorizedException('Organization is unavailable');
    }
  }

  async updateCurrentTenant(
    tenantId: string,
    dto: UpdateTenantDto,
  ): Promise<ApiSuccessResponse<TenantPublic>> {
    if (dto.name === undefined && dto.isActive === undefined) {
      throw new BadRequestException('No fields to update');
    }
    const updated = await this.tenantRepository.updateByTenantId(tenantId, {
      name: dto.name,
      isActive: dto.isActive,
    });
    if (!updated) {
      throw new NotFoundException('Tenant not found');
    }
    return {
      success: true,
      message: 'Tenant updated',
      data: toTenantPublic(updated),
    };
  }

  async getCurrentTenant(
    tenantId: string,
  ): Promise<ApiSuccessResponse<TenantPublic>> {
    const tenant = await this.tenantRepository.findActiveByTenantId(tenantId);
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
    return {
      success: true,
      message: 'Tenant details fetched',
      data: toTenantPublic(tenant),
    };
  }
}
