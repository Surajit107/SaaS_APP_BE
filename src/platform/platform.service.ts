import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { SubscriptionRepository } from '../billing/repositories/subscription.repository';
import type { ApiSuccessResponse } from '../common/types/api-response.types';
import { UpdateTenantDto } from '../tenant/dto/update-tenant.dto';
import { toTenantPublic } from '../tenant/mappers/tenant-public.mapper';
import { TenantRepository } from '../tenant/repositories/tenant.repository';
import type { TenantPublic } from '../tenant/types/tenant-public.types';
import { UserRepository } from '../user/repositories/user.repository';
import type { PlatformTenantListQueryDto } from './dto/platform-tenant-list-query.dto';

/** Tenant directory row plus Mongo billing summary for platform list UI. */
export type PlatformTenantListItem = TenantPublic & {
  subscription: { status: string; planKey: string } | null;
};

@Injectable()
export class PlatformService {
  constructor(
    private readonly tenantRepository: TenantRepository,
    private readonly userRepository: UserRepository,
    private readonly subscriptionRepository: SubscriptionRepository,
  ) {}

  async listTenants(query: PlatformTenantListQueryDto): Promise<
    ApiSuccessResponse<{
      items: PlatformTenantListItem[];
      total: number;
      page: number;
      limit: number;
    }>
  > {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const includeDeleted = query.includeDeleted === true;
    const { items, total } =
      await this.tenantRepository.findManyPaginatedForPlatformAdmin({
        skip,
        limit,
        includeDeleted,
        search: query.search,
        isActive: query.isActive,
      });
    const tenantIds = items.map((d) => d.tenantId);
    const subsByTenant =
      await this.subscriptionRepository.findSummariesByTenantIds(tenantIds);
    const listItems: PlatformTenantListItem[] = items.map((d) => {
      const base = toTenantPublic(d);
      const sub = subsByTenant.get(d.tenantId);
      return {
        ...base,
        subscription: sub !== undefined ? sub : null,
      };
    });
    return {
      success: true,
      message: 'OK',
      data: {
        items: listItems,
        total,
        page,
        limit,
      },
    };
  }

  async getTenantByTenantId(
    tenantId: string,
  ): Promise<ApiSuccessResponse<TenantPublic>> {
    if (!Types.ObjectId.isValid(tenantId)) {
      throw new BadRequestException('Invalid tenant id');
    }
    const doc = await this.tenantRepository.findByTenantId(tenantId);
    if (!doc) {
      throw new NotFoundException('Tenant not found');
    }
    return {
      success: true,
      message: 'OK',
      data: toTenantPublic(doc),
    };
  }

  async updateTenant(
    tenantId: string,
    dto: UpdateTenantDto,
  ): Promise<ApiSuccessResponse<TenantPublic>> {
    if (!Types.ObjectId.isValid(tenantId)) {
      throw new BadRequestException('Invalid tenant id');
    }
    if (dto.name === undefined && dto.isActive === undefined) {
      throw new BadRequestException('No fields to update');
    }
    const current = await this.tenantRepository.findByTenantId(tenantId);
    if (!current) {
      throw new NotFoundException('Tenant not found');
    }
    if (current.deletedAt != null) {
      throw new ConflictException(
        'Tenant is scheduled for purge and cannot be updated',
      );
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

  async softDeleteTenant(
    tenantId: string,
  ): Promise<
    ApiSuccessResponse<Pick<TenantPublic, 'id' | 'deletedAt' | 'purgeAt'>>
  > {
    if (!Types.ObjectId.isValid(tenantId)) {
      throw new BadRequestException('Invalid tenant id');
    }
    const current = await this.tenantRepository.findByTenantId(tenantId);
    if (!current) {
      throw new NotFoundException('Tenant not found');
    }
    if (current.deletedAt != null) {
      throw new ConflictException(
        'Tenant is already scheduled for removal (TTL purge)',
      );
    }
    const deleted = await this.tenantRepository.softDeleteByTenantId(tenantId);
    if (!deleted) {
      throw new NotFoundException('Tenant not found');
    }
    return {
      success: true,
      message:
        'Tenant soft-deleted; document will be removed by MongoDB after the retention window',
      data: {
        id: deleted.tenantId,
        deletedAt: deleted.deletedAt!.toISOString(),
        purgeAt: deleted.purgeAt!.toISOString(),
      },
    };
  }

  async overview(): Promise<
    ApiSuccessResponse<{
      tenantsActive: number;
      tenantsPendingPurge: number;
      userCount: number;
    }>
  > {
    const [tenantsActive, tenantsPendingPurge, userCount] = await Promise.all([
      this.tenantRepository.countActiveForPlatformAdmin(),
      this.tenantRepository.countPendingPurgeForPlatformAdmin(),
      this.userRepository.countAllForPlatformAdmin(),
    ]);
    return {
      success: true,
      message: 'OK',
      data: {
        tenantsActive,
        tenantsPendingPurge,
        userCount,
      },
    };
  }
}
