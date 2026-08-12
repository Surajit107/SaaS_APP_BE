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
import { AuthService } from '../auth/auth.service';
import { UserMfaRepository } from '../auth/mfa/repositories/user-mfa.repository';
import type { PlatformTenantListQueryDto } from './dto/platform-tenant-list-query.dto';
import type { PlatformUserSearchQueryDto } from './dto/platform-user-search-query.dto';

/** Tenant directory row plus Mongo billing summary for platform list UI. */
export type PlatformTenantListItem = TenantPublic & {
  subscription: { status: string; planKey: string } | null;
};

/** Enough to identify an account during lockout support, and nothing more. */
export interface PlatformUserSearchItem {
  id: string;
  email: string;
  displayName: string | null;
  tenantId: string;
  organizationName: string | null;
  isPlatformAdmin: boolean;
  isActive: boolean;
  isTotpEnabled: boolean;
  totpEnabledAt: string | null;
}

const USER_SEARCH_LIMIT = 10;

@Injectable()
export class PlatformService {
  constructor(
    private readonly tenantRepository: TenantRepository,
    private readonly userRepository: UserRepository,
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly userMfaRepository: UserMfaRepository,
    private readonly authService: AuthService,
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

  /**
   * Account lookup for lockout support. Returns just enough to identify the
   * right person and see whether a second factor is actually in the way.
   */
  async searchUsers(
    query: PlatformUserSearchQueryDto,
  ): Promise<ApiSuccessResponse<{ items: PlatformUserSearchItem[] }>> {
    const users = await this.userRepository.searchForPlatformAdmin(
      query.search,
      USER_SEARCH_LIMIT,
    );
    const items = await Promise.all(
      users.map(async (user): Promise<PlatformUserSearchItem> => {
        const userId = user._id.toString();
        const mfa = await this.userMfaRepository.findByUserId(userId);
        const tenant =
          (user.tenantId ?? '').length > 0
            ? await this.tenantRepository.findByTenantId(user.tenantId)
            : null;
        return {
          id: userId,
          email: user.email,
          displayName: user.displayName ?? null,
          tenantId: user.tenantId ?? '',
          organizationName: tenant?.name ?? null,
          isPlatformAdmin: user.isPlatformAdmin === true,
          isActive: user.isActive !== false,
          isTotpEnabled: mfa?.isTotpEnabled === true,
          totpEnabledAt: mfa?.totpEnabledAt?.toISOString() ?? null,
        };
      }),
    );
    return { success: true, message: 'OK', data: { items } };
  }

  async resetUserMfa(
    userId: string,
    performedByEmail: string,
  ): Promise<ApiSuccessResponse<{ userId: string; revokedSessions: number }>> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user id');
    }
    const { email, revokedSessions } = await this.authService.resetMfaForUser(
      userId,
      performedByEmail,
    );
    return {
      success: true,
      message: `Two-factor authentication reset for ${email}. They were signed out everywhere and notified by email.`,
      data: { userId, revokedSessions },
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
