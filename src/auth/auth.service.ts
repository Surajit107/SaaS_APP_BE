import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
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
import { RequestLoginCodeDto } from './dto/request-login-code.dto';
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
import { VerifyMfaDto } from './mfa/dto/mfa.dto';
import { UserMfaRepository } from './mfa/repositories/user-mfa.repository';
import type { MfaChallengeDocument } from './mfa/schemas/mfa-challenge.schema';
import { EmailCodeService } from './mfa/services/email-code.service';
import { MfaChallengeService } from './mfa/services/mfa-challenge.service';
import { MfaVerificationService } from './mfa/services/mfa-verification.service';
import type { MfaRequiredPayload } from './mfa/types/mfa.types';

const BCRYPT_ROUNDS = 12;
const EMAIL_VERIFY_TTL_MS = 48 * 3600 * 1000;
/** Emailed codes travel through a slower channel, so they live longer than a TOTP challenge. */
const EMAIL_CODE_TTL_MINUTES = 10;

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

/**
 * `login` returns a full session only when no second factor is required.
 * Otherwise it returns a challenge and the caller must complete
 * `POST /auth/mfa/verify` before any token exists.
 */
export type LoginResult = AuthSessionPayload | MfaRequiredPayload;

export function isMfaRequired(
  result: LoginResult,
): result is MfaRequiredPayload {
  return (result as MfaRequiredPayload).mfaRequired === true;
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
    private readonly userMfaRepository: UserMfaRepository,
    private readonly mfaChallengeService: MfaChallengeService,
    private readonly mfaVerificationService: MfaVerificationService,
    private readonly emailCodeService: EmailCodeService,
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


  async login(dto: LoginDto): Promise<ApiSuccessResponse<LoginResult>> {
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

    const userId = user._id.toString();
    const mfa = await this.userMfaRepository.findByUserId(userId);
    if (mfa?.isTotpEnabled === true) {
      const challenge = await this.mfaChallengeService.issue({
        userId,
        tenantId: user.tenantId ?? '',
        purpose: 'totp',
        authScope: dto.authScope,
        tenantRole: dto.tenantRole,
      });
      return {
        success: true,
        message: 'Enter the code from your authenticator app to finish signing in.',
        data: {
          mfaRequired: true,
          challengeToken: challenge.challengeToken,
          methods: ['totp', 'backup_code'],
          expiresAt: challenge.expiresAt.toISOString(),
        },
      };
    }

    const session = await this.issueTokenPair(user);
    return {
      success: true,
      message: 'Authenticated',
      data: session,
    };
  }

  /**
   * Emails a one-time code that signs the user in without a password.
   *
   * The response is deliberately identical whether or not the address belongs to
   * an account: an ineligible request still gets a challenge token, it just has
   * no code behind it. Otherwise this endpoint would enumerate every user.
   */
  async requestLoginCode(
    dto: RequestLoginCodeDto,
  ): Promise<ApiSuccessResponse<MfaRequiredPayload>> {
    const email = dto.email.toLowerCase().trim();
    const user = await this.userRepository.findByEmailWithCredentials(email);
    const eligible =
      user !== null &&
      user !== undefined &&
      (await this.isEligibleForEmailCodeLogin(user, dto));

    const ttlMinutes = this.getEmailCodeTtlMinutes();
    let codeHash: string | undefined;
    let plainCode: string | undefined;
    if (eligible) {
      const generated = await this.emailCodeService.generate();
      codeHash = generated.codeHash;
      plainCode = generated.code;
    }

    const challenge = await this.mfaChallengeService.issue({
      userId: eligible ? user?._id.toString() : undefined,
      tenantId: eligible ? (user?.tenantId ?? '') : '',
      purpose: 'email_code',
      authScope: dto.authScope,
      tenantRole: dto.tenantRole,
      codeHash,
      ttlMinutes,
    });

    if (plainCode !== undefined) {
      // Delivery problems must not change the response, or failures would leak
      // which addresses are real.
      try {
        await this.emailService.sendLoginCodeEmail({
          to: email,
          code: plainCode,
          expiresInMinutes: ttlMinutes,
        });
      } catch (error: unknown) {
        this.log.error(
          `Failed to send login code to ${email}: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    }

    return {
      success: true,
      message:
        'If that address belongs to an account, a sign-in code is on its way.',
      data: {
        mfaRequired: true,
        challengeToken: challenge.challengeToken,
        methods: ['email_code'],
        expiresAt: challenge.expiresAt.toISOString(),
      },
    };
  }

  /**
   * Mirrors every gate `login` applies, minus the password. Returns false rather
   * than throwing so the caller can stay silent about the reason.
   */
  private async isEligibleForEmailCodeLogin(
    user: UserDocument,
    dto: RequestLoginCodeDto,
  ): Promise<boolean> {
    if (user.isActive === false) {
      return false;
    }
    if (dto.authScope === 'platform') {
      if (user.isPlatformAdmin !== true) {
        return false;
      }
    } else {
      if (user.isPlatformAdmin === true || !(user.tenantId ?? '').trim()) {
        return false;
      }
      if (user.role !== dto.tenantRole) {
        return false;
      }
      if (tenantHasPendingEmailVerification(user)) {
        return false;
      }
    }

    const mfa = await this.userMfaRepository.findByUserId(user._id.toString());
    return mfa?.isEmailCodeLoginEnabled !== false;
  }

  private getEmailCodeTtlMinutes(): number {
    const parsed = Number.parseInt(
      this.configService.get<string>('MFA_EMAIL_CODE_TTL_MINUTES') ?? '',
      10,
    );
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : EMAIL_CODE_TTL_MINUTES;
  }

  /**
   * Completes a login that was interrupted by a second-factor challenge.
   *
   * Scope and role come from the stored challenge rather than the request, so
   * this step cannot be used to escalate the session it was issued for.
   */
  async verifyMfaChallenge(
    dto: VerifyMfaDto,
  ): Promise<ApiSuccessResponse<AuthSessionPayload>> {
    const challenge = await this.mfaChallengeService.load(dto.challengeToken);
    const userId = challenge.userId?.toString();
    if (userId === undefined || userId.length === 0) {
      throw new UnauthorizedException(
        'This verification request is no longer valid. Please sign in again.',
      );
    }

    const user = await this.userRepository.findByIdForTokenRefresh(userId);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    assertLoginScopeMatchesUser(challenge.authScope, user);
    if (user.isActive === false) {
      throw new UnauthorizedException('Account is not active.');
    }

    // An emailed code proves control of the mailbox, which is a factor in its
    // own right — so it completes the login even when TOTP is enabled.
    const method =
      challenge.purpose === 'email_code'
        ? await this.verifyEmailCodeChallenge(challenge, dto.code)
        : await this.mfaVerificationService.verify(userId, dto.code);
    if (method === null) {
      // Throws with the number of attempts left, or retires the challenge.
      await this.mfaChallengeService.registerFailedAttempt(challenge);
    }

    await this.mfaChallengeService.consume(challenge);
    const session = await this.issueTokenPair(user);
    await this.mfaChallengeService.clearForUser(userId);

    this.log.log(`MFA login completed for user ${userId} via ${String(method)}`);
    return {
      success: true,
      message:
        method === 'backup_code'
          ? 'Authenticated with a recovery code. That code has now been used.'
          : 'Authenticated',
      data: session,
    };
  }

  /**
   * Platform-operator recovery for someone locked out of their own account:
   * clears the second factor entirely and drops every session, so the next
   * sign-in is password-only. The account owner is always told it happened.
   */
  async resetMfaForUser(
    userId: string,
    performedByEmail: string,
  ): Promise<{ email: string; revokedSessions: number }> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.userMfaRepository.disableTotp(userId);
    await this.mfaChallengeService.clearForUser(userId);
    const revokedSessions =
      await this.refreshTokenRepository.deleteByUserId(userId);

    this.log.warn(
      `MFA reset for user ${userId} by platform operator ${performedByEmail}; revoked ${revokedSessions} session(s)`,
    );

    try {
      await this.emailService.sendSecurityChangeEmail({
        to: user.email,
        subjectLine: 'Two-factor authentication was reset',
        headline: 'Two-factor authentication was reset on your account',
        bodyLines: [
          'A platform administrator reset the second factor on your account, usually in response to a lockout request.',
          'You can sign in with your password alone right now. Any recovery codes you saved no longer work.',
          'Set up an authenticator app again from your security settings to restore protection.',
        ],
      });
    } catch (error: unknown) {
      this.log.error(
        `Failed to send MFA reset notice to ${user.email}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }

    return { email: user.email, revokedSessions };
  }

  private async verifyEmailCodeChallenge(
    challenge: MfaChallengeDocument,
    submittedCode: string,
  ): Promise<'email_code' | null> {
    const matches = await this.emailCodeService.verify(
      submittedCode,
      challenge.codeHash,
    );
    return matches ? 'email_code' : null;
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
