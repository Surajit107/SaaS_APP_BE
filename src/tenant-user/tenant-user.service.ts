import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectConnection } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Connection } from 'mongoose';
import { randomBytes } from 'node:crypto';
import {
  TenantUserManagementEventName,
  type TenantUserInvitedPayload,
} from '../common/domain-events/tenant-user-management.domain-events';
import { isTransactionUnavailableError } from '../common/mongoose/transaction.util';
import { TenantService } from '../tenant/tenant.service';
import type { AuthenticatedRequestUser } from '../auth/types/auth-request-user.types';
import type { ApiSuccessResponse } from '../common/types/api-response.types';
import { UserRepository } from '../user/repositories/user.repository';
import type { UserDocument } from '../user/schemas/user.schema';
import { SubscriptionEntitlementsService } from '../billing/services/subscription-entitlements.service';
import { TenantUserInviteRepository } from './repositories/tenant-user-invite.repository';
import type { AcceptInviteDto } from './dto/accept-invite.dto';
import type { CreateTenantUserDto } from './dto/create-tenant-user.dto';
import type { ListTenantUsersQueryDto } from './dto/list-tenant-users.query.dto';
import type { UpdateTenantMeDto } from './dto/update-tenant-me.dto';
import type { UpdateTenantUserDto } from './dto/update-tenant-user.dto';

const BCRYPT_ROUNDS = 12;

export interface TenantUserProfile {
  id: string;
  email: string;
  displayName: string | undefined;
  role: 'admin' | 'member';
  isActive: boolean;
  isEmailVerified: boolean;
  tenantId: string;
  createdAt: Date | undefined;
}

export interface PaginatedTenantUsers {
  users: TenantUserProfile[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Injectable()
export class TenantUserService {
  private readonly log = new Logger(TenantUserService.name);

  constructor(
    @InjectConnection() private readonly mongoConnection: Connection,
    private readonly userRepository: UserRepository,
    private readonly inviteRepository: TenantUserInviteRepository,
    private readonly tenantService: TenantService,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    private readonly entitlements: SubscriptionEntitlementsService,
  ) {}

  // ─── Read operations (no transaction needed) ──────────────────────────────

  /**
   * Self-service: update the signed-in tenant user's display name only.
   */
  async patchCurrentUserMe(
    user: AuthenticatedRequestUser,
    dto: UpdateTenantMeDto,
  ): Promise<ApiSuccessResponse<TenantUserProfile>> {
    const trimmed = dto.displayName.trim();
    const nextValue = trimmed.length > 0 ? trimmed : null;
    const updated = await this.userRepository.updateDisplayNameByIdAndTenantId(
      user.userId,
      user.tenantId,
      nextValue,
    );
    if (!updated) {
      throw new NotFoundException('User not found');
    }
    return {
      success: true,
      message: 'Profile updated',
      data: this.toProfile(updated),
    };
  }

  async listUsers(
    tenantId: string,
    query: ListTenantUsersQueryDto,
  ): Promise<ApiSuccessResponse<PaginatedTenantUsers>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { docs, total } = await this.userRepository.findAllByTenantId(
      tenantId,
      { page, limit, search: query.search },
    );
    const totalPages = Math.ceil(total / limit);
    return {
      success: true,
      message: 'OK',
      data: {
        users: docs.map(this.toProfile),
        total,
        page,
        limit,
        totalPages,
      },
    };
  }

  async getUserById(
    tenantId: string,
    userId: string,
  ): Promise<ApiSuccessResponse<TenantUserProfile>> {
    const user = await this.userRepository.findByIdAndTenantId(userId, tenantId);
    if (!user) throw new NotFoundException('User not found');
    return { success: true, message: 'OK', data: this.toProfile(user) };
  }

  /**
   * Update display name, role, or active status.
   * Single-document write — no transaction required.
   */
  async updateUser(
    tenantId: string,
    targetUserId: string,
    dto: UpdateTenantUserDto,
  ): Promise<ApiSuccessResponse<TenantUserProfile>> {
    const user = await this.userRepository.findByIdAndTenantId(
      targetUserId,
      tenantId,
    );
    if (!user) throw new NotFoundException('User not found');

    const updated = await this.userRepository.updateById(targetUserId, {
      ...(dto.displayName !== undefined && { displayName: dto.displayName }),
      ...(dto.role !== undefined && { role: dto.role }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
    });
    return {
      success: true,
      message: 'User updated',
      data: this.toProfile(updated ?? user),
    };
  }

  // ─── Multi-document writes (transaction + compensating fallback) ──────────

  /**
   * Invite flow:
   *  1. Validate email (cross-tenant conflict check).
   *  2. Hash invite token (CPU-bound, done before the transaction).
   *  3. Atomically write user record + invite record inside a session.
   *  4. Emit domain event after commit (fire-and-forget for email).
   *
   * Compensating path (standalone MongoDB without a replica set):
   *  - New user: create user → upsert invite → if invite fails, delete created user and re-throw.
   *  - Re-invite: update user → upsert invite → if invite fails, log and re-throw
   *    (user metadata updated but invite absent; admin can retry — no security risk since
   *     user stays inactive and cannot log in).
   */
  async inviteUser(
    requester: AuthenticatedRequestUser,
    dto: CreateTenantUserDto,
  ): Promise<ApiSuccessResponse<TenantUserProfile>> {
    const emailNorm = dto.email.toLowerCase().trim();
    const role = dto.role ?? 'member';

    // ── Pre-transaction reads ──────────────────────────────────────────────
    const existing = await this.userRepository.findByEmail(emailNorm);
    if (existing) {
      if (existing.tenantId !== requester.tenantId) {
        throw new ConflictException(
          'This email address is already associated with another organisation.',
        );
      }
      if (existing.isActive) {
        throw new ConflictException(
          'A user with this email is already an active member of your organisation.',
        );
      }
      // Inactive → previous invite not accepted → re-invite allowed.
    }

    const tenant = await this.tenantService.getCurrentTenant(requester.tenantId);
    const tenantName =
      (tenant.data as { name?: string } | undefined)?.name ?? requester.tenantId;

    // ── Subscription quota check ───────────────────────────────────────────
    // Re-inviting an inactive user does not add a seat — skip the limit check.
    // A new invite creates a new user record, so the seat count increases by one.
    const isReInvite =
      existing !== null &&
      existing.tenantId === requester.tenantId &&
      !existing.isActive;

    if (!isReInvite) {
      const currentUserCount = await this.userRepository.countByTenantId(
        requester.tenantId,
      );
      await this.entitlements.assertWithinUserLimit(requester.tenantId, currentUserCount);
    }

    // ── Token generation (CPU-bound, must be outside the transaction) ──────
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = await bcrypt.hash(rawToken, BCRYPT_ROUNDS);

    // ── Transactional writes ───────────────────────────────────────────────
    let userDoc: UserDocument;
    const session = await this.mongoConnection.startSession();
    try {
      try {
        userDoc = await session.withTransaction(async () => {
          if (isReInvite && existing) {
            const updated = await this.userRepository.updateById(
              existing._id.toString(),
              { role, displayName: dto.displayName },
              session,
            );
            await this.inviteRepository.upsert(
              {
                tenantId: requester.tenantId,
                email: emailNorm,
                tokenHash,
                invitedByUserId: requester.userId,
                role,
                displayName: dto.displayName,
              },
              session,
            );
            return (updated ?? existing) as UserDocument;
          }

          const created = await this.userRepository.createUser(
            {
              tenantId: requester.tenantId,
              email: emailNorm,
              role,
              displayName: dto.displayName,
              isActive: false,
            },
            session,
          );
          await this.inviteRepository.upsert(
            {
              tenantId: requester.tenantId,
              email: emailNorm,
              tokenHash,
              invitedByUserId: requester.userId,
              role,
              displayName: dto.displayName,
            },
            session,
          );
          return created;
        });
      } catch (err) {
        if (!isTransactionUnavailableError(err)) throw err;
        this.log.warn(
          'MongoDB transactions unavailable; falling back to compensating invite flow',
        );
        userDoc = await this.inviteWithoutTransaction(
          requester,
          emailNorm,
          role,
          dto.displayName,
          tokenHash,
          isReInvite,
          existing,
        );
      }
    } finally {
      await session.endSession();
    }

    const inviterDoc = await this.userRepository.findByIdAndTenantId(
      requester.userId,
      requester.tenantId,
    );
    const invitedByDisplayName = inviterDoc?.displayName?.trim() || undefined;

    // ── Post-commit: fire-and-forget email event ───────────────────────────
    const invitePayload: TenantUserInvitedPayload = {
      tenantId: requester.tenantId,
      tenantName,
      invitedByUserId: requester.userId,
      invitedByEmail: requester.email,
      invitedByDisplayName,
      email: emailNorm,
      displayName: dto.displayName,
      role,
      rawToken,
    };
    try {
      await this.eventEmitter.emitAsync(
        TenantUserManagementEventName.UserInvited,
        invitePayload,
      );
    } catch (err) {
      this.log.warn(
        `UserInvited event dispatch failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return {
      success: true,
      message: 'Invitation sent. The user will receive an email to set their password.',
      data: this.toProfile(userDoc),
    };
  }

  /**
   * Accept invite flow:
   *  1. Verify token (read + bcrypt compare — done before transaction).
   *  2. Atomically activate user + delete invite record inside a session.
   *
   * Compensating path: update user first, then delete invite. If the invite
   * deletion fails, the orphan is harmless — TTL will purge it, and a repeat
   * accept attempt with the same token will still verify correctly but find
   * an already-active user (safe no-op from the user's perspective).
   */
  async acceptInvite(
    dto: AcceptInviteDto,
  ): Promise<ApiSuccessResponse<{ message: string }>> {
    const emailNorm = dto.email.toLowerCase().trim();

    // ── Pre-transaction reads + token verification ─────────────────────────
    const invite = await this.inviteRepository.findByEmailWithToken(emailNorm);
    if (!invite) {
      throw new UnauthorizedException('Invalid or expired invitation link.');
    }
    if (invite.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException(
        'This invitation link has expired. Ask your administrator to resend the invitation.',
      );
    }
    const tokenValid = await bcrypt.compare(dto.token, invite.tokenHash);
    if (!tokenValid) {
      throw new UnauthorizedException('Invalid invitation token.');
    }

    const user = await this.userRepository.findByEmailInTenant(
      emailNorm,
      invite.tenantId,
    );
    if (!user) {
      this.log.error(
        `Invite accepted but no user found: email=${emailNorm} tenantId=${invite.tenantId}`,
      );
      throw new UnauthorizedException('Invalid or expired invitation link.');
    }

    // ── Hash password (CPU-bound, before the transaction) ──────────────────
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const userId = user._id.toString();
    const inviteId = invite._id.toString();

    // ── Transactional writes ───────────────────────────────────────────────
    const session = await this.mongoConnection.startSession();
    try {
      try {
        await session.withTransaction(async () => {
          await this.userRepository.updateById(
            userId,
            { passwordHash, isEmailVerified: true, isActive: true },
            session,
          );
          await this.inviteRepository.deleteById(inviteId, session);
        });
      } catch (err) {
        if (!isTransactionUnavailableError(err)) throw err;
        this.log.warn(
          'MongoDB transactions unavailable; falling back to compensating accept-invite flow',
        );
        await this.acceptInviteWithoutTransaction(userId, passwordHash, inviteId);
      }
    } finally {
      await session.endSession();
    }

    return {
      success: true,
      message:
        'Password set successfully. You can now log in with your email and password.',
      data: { message: 'Account activated' },
    };
  }

  /**
   * Delete user flow:
   *  1. Guard: cannot delete own account.
   *  2. Verify target user exists in this tenant (pre-transaction read).
   *  3. Atomically delete user + any pending invite inside a session.
   *
   * Compensating path: delete user first, then delete invite. A dangling
   * invite for a deleted user is harmless — accept-invite will fail to find
   * the user record and reject the token.
   */
  async deleteUser(
    tenantId: string,
    targetUserId: string,
    requestingUserId: string,
  ): Promise<ApiSuccessResponse<null>> {
    if (targetUserId === requestingUserId) {
      throw new ForbiddenException('You cannot delete your own account.');
    }

    // ── Pre-transaction read ───────────────────────────────────────────────
    const user = await this.userRepository.findByIdAndTenantId(
      targetUserId,
      tenantId,
    );
    if (!user) throw new NotFoundException('User not found');
    const email = user.email;

    // ── Transactional writes ───────────────────────────────────────────────
    const session = await this.mongoConnection.startSession();
    try {
      try {
        await session.withTransaction(async () => {
          await this.userRepository.deleteByIdAndTenantId(
            targetUserId,
            tenantId,
            session,
          );
          // deleteOne on a non-existent invite is a no-op — safe to call unconditionally.
          await this.inviteRepository.deleteByEmailAndTenantId(
            email,
            tenantId,
            session,
          );
        });
      } catch (err) {
        if (!isTransactionUnavailableError(err)) throw err;
        this.log.warn(
          'MongoDB transactions unavailable; falling back to compensating delete-user flow',
        );
        await this.deleteUserWithoutTransaction(targetUserId, tenantId, email);
      }
    } finally {
      await session.endSession();
    }

    return { success: true, message: 'User deleted', data: null };
  }

  // ─── Compensating (non-transactional) fallbacks ───────────────────────────

  private async inviteWithoutTransaction(
    requester: AuthenticatedRequestUser,
    emailNorm: string,
    role: 'admin' | 'member',
    displayName: string | undefined,
    tokenHash: string,
    isReInvite: boolean,
    existing: UserDocument | null,
  ): Promise<UserDocument> {
    const inviteInput = {
      tenantId: requester.tenantId,
      email: emailNorm,
      tokenHash,
      invitedByUserId: requester.userId,
      role,
      displayName,
    };

    if (isReInvite && existing) {
      const updated = await this.userRepository.updateById(
        existing._id.toString(),
        { role, displayName },
      );
      try {
        await this.inviteRepository.upsert(inviteInput);
      } catch (inviteErr) {
        // User metadata updated but invite write failed.
        // User stays inactive — admin can retry. Log and surface the error.
        this.log.error(
          `Compensating re-invite: invite upsert failed for email=${emailNorm}: ${
            inviteErr instanceof Error ? inviteErr.message : String(inviteErr)
          }`,
        );
        throw inviteErr;
      }
      return (updated ?? existing) as UserDocument;
    }

    // New user path.
    const created = await this.userRepository.createUser({
      tenantId: requester.tenantId,
      email: emailNorm,
      role,
      displayName,
      isActive: false,
    });
    try {
      await this.inviteRepository.upsert(inviteInput);
    } catch (inviteErr) {
      // Roll back: delete the user we just created.
      this.log.error(
        `Compensating invite: invite upsert failed, rolling back user creation for email=${emailNorm}`,
      );
      await this.userRepository
        .deleteByIdAndTenantId(created._id.toString(), requester.tenantId)
        .catch((deleteErr: unknown) => {
          this.log.error(
            `Compensating invite rollback also failed for userId=${created._id.toString()}: ${
              deleteErr instanceof Error ? deleteErr.message : String(deleteErr)
            }`,
          );
        });
      throw inviteErr;
    }
    return created;
  }

  private async acceptInviteWithoutTransaction(
    userId: string,
    passwordHash: string,
    inviteId: string,
  ): Promise<void> {
    await this.userRepository.updateById(userId, {
      passwordHash,
      isEmailVerified: true,
      isActive: true,
    });
    await this.inviteRepository.deleteById(inviteId).catch((err: unknown) => {
      // User is already activated — dangling invite is benign; TTL will purge it.
      this.log.warn(
        `Compensating accept-invite: invite deletion failed for inviteId=${inviteId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
  }

  private async deleteUserWithoutTransaction(
    targetUserId: string,
    tenantId: string,
    email: string,
  ): Promise<void> {
    await this.userRepository.deleteByIdAndTenantId(targetUserId, tenantId);
    await this.inviteRepository
      .deleteByEmailAndTenantId(email, tenantId)
      .catch((err: unknown) => {
        // User is deleted; a dangling invite is harmless — accept-invite will reject it.
        this.log.warn(
          `Compensating delete-user: invite cleanup failed for email=${email}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private toProfile(doc: UserDocument): TenantUserProfile {
    const raw = doc.toObject<{
      _id: { toString(): string };
      email: string;
      displayName?: string;
      role: 'admin' | 'member';
      isActive: boolean;
      isEmailVerified: boolean;
      tenantId: string;
      createdAt?: Date;
    }>();
    return {
      id: raw._id.toString(),
      email: raw.email,
      displayName: raw.displayName,
      role: raw.role,
      isActive: raw.isActive,
      isEmailVerified: raw.isEmailVerified,
      tenantId: raw.tenantId,
      createdAt: raw.createdAt,
    };
  }
}
