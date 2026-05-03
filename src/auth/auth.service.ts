import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { InjectConnection } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { ClientSession, Connection } from 'mongoose';
import { randomBytes, randomUUID } from 'node:crypto';
import { UserDocument } from '../user/schemas/user.schema';
import type { ApiSuccessResponse } from '../common/types/api-response.types';
import { UserRepository } from '../user/repositories/user.repository';
import { AuthIdentityRepository } from './repositories/auth-identity.repository';
import { RefreshTokenRepository } from './repositories/refresh-token.repository';
import { CreateTenantDto } from '../tenant/dto/create-tenant.dto';
import { TenantService } from '../tenant/tenant.service';
import type { AuthLoginScope, TenantLoginPortalRole } from './dto/login.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { AuthenticatedRequestUser } from './types/auth-request-user.types';
import { JwtAccessPayload } from './types/jwt-payload.types';
import { parseJwtExpiresIn } from './utils/jwt-expires.util';
import {
  TenantAuthEventName,
  type TenantUserRegisteredPayload,
} from '../common/domain-events/tenant-auth.domain-events';
import { isTransactionUnavailableError } from '../common/mongoose/transaction.util';
import { EmailService } from '../email/email.service';

const BCRYPT_ROUNDS = 12;
const EMAIL_VERIFY_TTL_MS = 48 * 3600 * 1000;

function tenantHasPendingEmailVerification(user: UserDocument): boolean {
  const hash = user.emailVerifyTokenHash;
  return (
    typeof hash === 'string' &&
    hash.length > 0 &&
    user.isEmailVerified !== true
  );
}

function assertLoginScopeMatchesUser(
  scope: AuthLoginScope,
  user: UserDocument,
): void {
  if (scope === 'platform') {
    if (user.isPlatformAdmin !== true) {
      throw new UnauthorizedException(
        'This account is not a platform operator. Use the organization sign-in page.',
      );
    }
    return;
  }
  if (user.isPlatformAdmin === true) {
    throw new UnauthorizedException(
      'Platform operators must sign in via the admin portal.',
    );
  }
  if (!(user.tenantId ?? '').trim()) {
    throw new UnauthorizedException(
      'This account cannot sign in on the organization portal.',
    );
  }
}

function assertTenantLoginPortalMatchesRole(
  dto: { authScope: AuthLoginScope; tenantRole?: TenantLoginPortalRole },
  user: UserDocument,
): void {
  if (dto.authScope !== 'tenant') {
    return;
  }
  const expected = dto.tenantRole;
  if (expected === undefined) {
    throw new UnauthorizedException('Invalid credentials');
  }
  if (user.role !== expected) {
    throw new UnauthorizedException(
      expected === 'admin'
        ? 'This page is for organization administrators only. Use the team member sign-in page.'
        : 'This page is for team members only. Use the organization admin sign-in page.',
    );
  }
}

export interface AuthSessionPayload {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: {
    id: string;
    email: string;
    tenantId: string;
    platformAdmin: boolean;
    tenantRole: 'admin' | 'member' | undefined;
    displayName?: string;
  };
}

/** Returned by `register` — no tokens; client must verify email then call `login`. */
export interface RegisterSuccessPayload {
  email: string;
  tenantId: string;
  organizationName: string;
  emailVerificationSent: boolean;
}

@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);

  constructor(
    @InjectConnection() private readonly mongoConnection: Connection,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly userRepository: UserRepository,
    private readonly tenantService: TenantService,
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly authIdentityRepository: AuthIdentityRepository,
    private readonly eventEmitter: EventEmitter2,
    private readonly emailService: EmailService,
  ) {}

  getModuleStatus(): ApiSuccessResponse<{
    module: string;
    dbReady: boolean;
  }> {
    return {
      success: true,
      message: 'Auth module ready',
      data: {
        module: 'auth',
        dbReady:
          this.authIdentityRepository.isMongooseReady() &&
          this.refreshTokenRepository.isMongooseReady() &&
          this.userRepository.isMongooseReady() &&
          this.tenantService.isDatabaseReady(),
      },
    };
  }

  async register(
    dto: RegisterDto,
  ): Promise<ApiSuccessResponse<RegisterSuccessPayload>> {
    const emailNorm = dto.email.toLowerCase().trim();
    const existing = await this.userRepository.findByEmail(emailNorm);
    if (existing) {
      throw new ConflictException('User already exists');
    }
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const rawEmailVerificationToken = randomBytes(32).toString('hex');
    const emailVerifyTokenHash = await bcrypt.hash(
      rawEmailVerificationToken,
      BCRYPT_ROUNDS,
    );
    const emailVerifyExpiresAt = new Date(Date.now() + EMAIL_VERIFY_TTL_MS);
    const displayNameTrimmed = dto.displayName.trim();
    const createTenant: CreateTenantDto = {
      name: dto.organizationName,
      isActive: true,
    };
    let registrationResult: { createdUser: UserDocument } | undefined;

    const mongoSession = await this.mongoConnection.startSession();
    try {
      try {
        registrationResult = await mongoSession.withTransaction(async () => {
          const tenant = await this.tenantService.create(createTenant, mongoSession);
          const createdUser = await this.userRepository.createUser(
            {
              tenantId: tenant.tenantId,
              email: emailNorm,
              passwordHash,
              role: 'admin',
              displayName: displayNameTrimmed,
              isEmailVerified: false,
              emailVerifyTokenHash,
              emailVerifyExpiresAt,
            },
            mongoSession,
          );
          return { createdUser };
        });
      } catch (err) {
        if (!isTransactionUnavailableError(err)) {
          throw err;
        }
        this.log.warn(
          'Mongo transactions unavailable; falling back to compensating registration flow',
        );
        registrationResult = await this.registerWithoutTransaction({
          createTenant,
          emailNorm,
          passwordHash,
          displayName: displayNameTrimmed,
          emailVerifyTokenHash,
          emailVerifyExpiresAt,
        });
      }
    } finally {
      await mongoSession.endSession();
    }

    if (!registrationResult) {
      throw new Error('Registration transaction failed');
    }
    const { createdUser } = registrationResult;

    let delivery: 'sent' | 'skipped';
    try {
      delivery =
        await this.emailService.sendOrganizerRegistrationVerificationEmail({
          email: emailNorm,
          organizationName: dto.organizationName.trim(),
          displayName: displayNameTrimmed,
          rawEmailVerificationToken,
        });
    } catch (err: unknown) {
      if (err instanceof HttpException) {
        try {
          await this.compensateFailedRegistration({
            userId: createdUser._id.toString(),
            tenantMongoId: createdUser.tenantId,
            tenantId: createdUser.tenantId,
          });
        } catch (rollbackErr: unknown) {
          this.log.error(
            `Registration rollback failed after email error: ${
              rollbackErr instanceof Error
                ? rollbackErr.message
                : String(rollbackErr)
            }`,
            rollbackErr instanceof Error ? rollbackErr.stack : undefined,
          );
          throw new InternalServerErrorException(
            'Registration could not be completed. Contact support.',
          );
        }
      }
      throw err;
    }

    const registeredPayload: TenantUserRegisteredPayload = {
      tenantId: createdUser.tenantId,
      userId: createdUser._id.toString(),
      email: emailNorm,
      organizationName: dto.organizationName.trim(),
      displayName: displayNameTrimmed,
      rawEmailVerificationToken,
    };
    try {
      await this.eventEmitter.emitAsync(
        TenantAuthEventName.UserRegistered,
        registeredPayload,
      );
    } catch (err) {
      this.log.warn(
        `UserRegistered event dispatch failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const emailVerificationSent = delivery === 'sent';
    return {
      success: true,
      message: emailVerificationSent
        ? 'Registered. Check your inbox for a verification link before signing in.'
        : 'Registered. Email is not configured on this server; ask an administrator to enable outbound mail before signing in.',
      data: {
        email: emailNorm,
        tenantId: createdUser.tenantId,
        organizationName: dto.organizationName.trim(),
        emailVerificationSent,
      },
    };
  }

  /**
   * Hard-delete user + tenant created during registration when post-commit steps fail (e.g. Resend).
   */
  private async compensateFailedRegistration(params: {
    userId: string;
    tenantMongoId: string;
    tenantId: string;
  }): Promise<void> {
    const mongoSession = await this.mongoConnection.startSession();
    try {
      try {
        await mongoSession.withTransaction(async () => {
          await this.userRepository.deleteByIdAndTenantId(
            params.userId,
            params.tenantId,
            mongoSession,
          );
          await this.tenantService.deleteById(
            params.tenantMongoId,
            mongoSession,
          );
        });
      } catch (err: unknown) {
        if (!isTransactionUnavailableError(err)) {
          throw err;
        }
        this.log.warn(
          'Mongo transactions unavailable; compensating registration with sequential deletes',
        );
        await this.userRepository.deleteByIdAndTenantId(
          params.userId,
          params.tenantId,
        );
        await this.tenantService.deleteById(params.tenantMongoId);
      }
    } finally {
      await mongoSession.endSession();
    }
  }

  private async registerWithoutTransaction(params: {
    createTenant: CreateTenantDto;
    emailNorm: string;
    passwordHash: string;
    displayName: string;
    emailVerifyTokenHash: string;
    emailVerifyExpiresAt: Date;
  }): Promise<{ createdUser: UserDocument }> {
    const tenant = await this.tenantService.create(params.createTenant);
    try {
      const createdUser = await this.userRepository.createUser({
        tenantId: tenant.tenantId,
        email: params.emailNorm,
        passwordHash: params.passwordHash,
        role: 'admin',
        displayName: params.displayName,
        isEmailVerified: false,
        emailVerifyTokenHash: params.emailVerifyTokenHash,
        emailVerifyExpiresAt: params.emailVerifyExpiresAt,
      });
      return { createdUser };
    } catch (err) {
      await this.tenantService.deleteById(tenant._id.toString());
      throw err;
    }
  }

  async verifyEmail(
    dto: VerifyEmailDto,
  ): Promise<ApiSuccessResponse<{ email: string }>> {
    const emailNorm = dto.email.toLowerCase().trim();
    const user =
      await this.userRepository.findByEmailWithEmailVerificationFields(emailNorm);
    if (!user) {
      throw new UnauthorizedException('Invalid verification request.');
    }
    if (user.isEmailVerified === true) {
      return {
        success: true,
        message: 'Email is already verified. You can sign in.',
        data: { email: emailNorm },
      };
    }
    const storedHash = user.emailVerifyTokenHash;
    if (typeof storedHash !== 'string' || storedHash.length === 0) {
      throw new BadRequestException(
        'No pending email verification for this address.',
      );
    }
    const expiresAt = user.emailVerifyExpiresAt;
    if (
      expiresAt instanceof Date &&
      !Number.isNaN(expiresAt.getTime()) &&
      expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException(
        'Verification link has expired. Contact support or register again.',
      );
    }
    const tokenOk = await bcrypt.compare(dto.token, storedHash);
    if (!tokenOk) {
      throw new UnauthorizedException('Invalid verification link.');
    }
    await this.userRepository.markEmailVerifiedAndClearVerificationToken(
      user._id.toString(),
    );
    return {
      success: true,
      message: 'Email verified. You can sign in.',
      data: { email: emailNorm },
    };
  }


  async login(dto: LoginDto): Promise<ApiSuccessResponse<AuthSessionPayload>> {
    const user = await this.userRepository.findByEmailWithCredentials(
      dto.email,
    );
    if (!user?.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }
    assertLoginScopeMatchesUser(dto.authScope, user);
    if (user.isActive === false) {
      throw new UnauthorizedException(
        'Account is pending activation. Please accept your invitation email to set a password.',
      );
    }
    if (
      dto.authScope === 'tenant' &&
      tenantHasPendingEmailVerification(user)
    ) {
      throw new UnauthorizedException(
        'Verify your email address before signing in. Check your inbox for the verification link.',
      );
    }
    const match = await bcrypt.compare(dto.password, user.passwordHash);
    if (!match) {
      throw new UnauthorizedException('Invalid credentials');
    }
    assertTenantLoginPortalMatchesRole(dto, user);
    const session = await this.issueTokenPair(user);
    return {
      success: true,
      message: 'Authenticated',
      data: session,
    };
  }

  async refresh(
    rawRefreshToken: string,
  ): Promise<ApiSuccessResponse<AuthSessionPayload>> {
    const parsed = this.parseOpaqueRefresh(rawRefreshToken);
    if (!parsed) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const { jti, secret } = parsed;
    const record = await this.refreshTokenRepository.findByJti(jti);
    if (!record) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (record.expiresAt.getTime() <= Date.now()) {
      await this.refreshTokenRepository.deleteByJti(jti);
      throw new UnauthorizedException('Refresh token expired');
    }
    const secretOk = await bcrypt.compare(secret, record.secretHash);
    if (!secretOk) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const user = await this.userRepository.findByIdForTokenRefresh(
      record.userId.toString(),
    );
    if (!user) {
      await this.refreshTokenRepository.deleteByJti(jti);
      throw new UnauthorizedException('User no longer exists');
    }
    await this.refreshTokenRepository.deleteByJti(jti);
    const session = await this.issueTokenPair(user, record.familyId);
    return {
      success: true,
      message: 'Token refreshed',
      data: session,
    };
  }

  async logout(
    rawRefreshToken?: string | null,
  ): Promise<ApiSuccessResponse<null>> {
    if (rawRefreshToken === undefined || rawRefreshToken === null) {
      return {
        success: true,
        message: 'Logged out',
        data: null,
      };
    }
    const normalizedRefreshToken = rawRefreshToken.trim();
    if (normalizedRefreshToken.length === 0) {
      return {
        success: true,
        message: 'Logged out',
        data: null,
      };
    }
    const parsed = this.parseOpaqueRefresh(normalizedRefreshToken);
    if (!parsed) {
      return {
        success: true,
        message: 'Logged out',
        data: null,
      };
    }
    const record = await this.refreshTokenRepository.findByJti(parsed.jti);
    if (!record) {
      return {
        success: true,
        message: 'Logged out',
        data: null,
      };
    }
    const secretOk = await bcrypt.compare(parsed.secret, record.secretHash);
    if (!secretOk) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    await this.refreshTokenRepository.deleteByJti(parsed.jti);
    return {
      success: true,
      message: 'Logged out',
      data: null,
    };
  }

  async getMe(
    user: AuthenticatedRequestUser,
  ): Promise<ApiSuccessResponse<AuthSessionPayload['user']>> {
    const base = {
      id: user.userId,
      email: user.email,
      tenantId: user.tenantId,
      platformAdmin: user.platformAdmin,
      tenantRole: user.tenantRole,
    } as const;
    if (user.platformAdmin) {
      return {
        success: true,
        message: 'OK',
        data: { ...base },
      };
    }
    const doc = await this.userRepository.findById(user.userId);
    const rawName = doc?.displayName;
    const displayName =
      typeof rawName === 'string' && rawName.trim().length > 0
        ? rawName.trim()
        : undefined;
    return {
      success: true,
      message: 'OK',
      data: {
        ...base,
        ...(displayName !== undefined ? { displayName } : {}),
      },
    };
  }

  private parseOpaqueRefresh(
    raw: string,
  ): { jti: string; secret: string } | null {
    const parts = raw.trim().split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return null;
    }
    const [jti, secret] = parts;
    return { jti, secret };
  }

  private getAccessExpiresInSeconds(): number {
    const raw = this.configService.get<string>('JWT_ACCESS_EXPIRES_IN', '15m');
    const match = /^(\d+)(m|h|d)$/.exec(raw.trim());
    if (match) {
      const n = Number.parseInt(match[1], 10);
      const unit = match[2];
      if (unit === 'm') return n * 60;
      if (unit === 'h') return n * 3600;
      if (unit === 'd') return n * 86400;
    }
    const asNum = Number.parseInt(raw, 10);
    if (!Number.isNaN(asNum) && asNum > 0) {
      return asNum;
    }
    return 900;
  }

  private getRefreshExpiresAt(): Date {
    const days = Number.parseInt(
      this.configService.get<string>('JWT_REFRESH_EXPIRES_DAYS', '7'),
      10,
    );
    const safeDays = Number.isFinite(days) && days > 0 ? days : 7;
    return new Date(Date.now() + safeDays * 86400000);
  }

  private async issueTokenPair(
    user: UserDocument,
    existingFamilyId?: string,
    session?: ClientSession,
  ): Promise<AuthSessionPayload> {
    const tenantId = user.tenantId ?? '';
    if (user.isPlatformAdmin !== true) {
      await this.tenantService.assertTenantActiveForAuth(tenantId);
      if (tenantHasPendingEmailVerification(user)) {
        throw new UnauthorizedException(
          'Verify your email address before using this account.',
        );
      }
    }
    const userId = user._id.toString();
    const expiresIn = this.getAccessExpiresInSeconds();
    const isPlatformAdmin = user.isPlatformAdmin === true;
    const payload: JwtAccessPayload = {
      type: 'access',
      sub: userId,
      email: user.email,
      tenantId,
      platformAdmin: isPlatformAdmin,
      tenantRole: isPlatformAdmin ? undefined : user.role,
    };
    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: parseJwtExpiresIn(
        this.configService.get<string>('JWT_ACCESS_EXPIRES_IN'),
        '15m',
      ),
    });
    const jti = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    const secretHash = await bcrypt.hash(secret, BCRYPT_ROUNDS);
    const familyId = existingFamilyId ?? randomUUID();
    const expiresAt = this.getRefreshExpiresAt();
    await this.refreshTokenRepository.createToken({
      jti,
      userId: user._id,
      tenantId,
      secretHash,
      familyId,
      expiresAt,
    }, session);
    const refreshToken = `${jti}.${secret}`;
    const dnRaw = user.displayName;
    const displayNameFromDoc =
      typeof dnRaw === 'string' && dnRaw.trim().length > 0 ? dnRaw.trim() : undefined;
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn,
      user: {
        id: userId,
        email: user.email,
        tenantId,
        platformAdmin: isPlatformAdmin,
        tenantRole: isPlatformAdmin ? undefined : user.role,
        ...(displayNameFromDoc !== undefined
          ? { displayName: displayNameFromDoc }
          : {}),
      },
    };
  }
}
