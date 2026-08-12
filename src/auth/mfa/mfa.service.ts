import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import type { ApiSuccessResponse } from '../../common/types/api-response.types';
import { SecretCipherService } from '../../common/crypto/secret-cipher.service';
import { EmailService } from '../../email/email.service';
import { UserRepository } from '../../user/repositories/user.repository';
import { RefreshTokenRepository } from '../repositories/refresh-token.repository';
import type { AuthenticatedRequestUser } from '../types/auth-request-user.types';
import type {
  DisableTotpDto,
  EnableTotpDto,
  RegenerateBackupCodesDto,
  UpdateMfaPreferencesDto,
} from './dto/mfa.dto';
import { UserMfaRepository } from './repositories/user-mfa.repository';
import type { UserMfaDocument } from './schemas/user-mfa.schema';
import { BackupCodeService } from './services/backup-code.service';
import { MfaChallengeService } from './services/mfa-challenge.service';
import { MfaVerificationService } from './services/mfa-verification.service';
import { TotpService } from './services/totp.service';
import type {
  BackupCodesPayload,
  MfaStatusPayload,
  TotpEnrollmentPayload,
} from './types/mfa.types';

/** How long a scanned-but-unconfirmed QR code stays valid. */
const ENROLLMENT_TTL_MS = 15 * 60_000;

/**
 * Enrollment and management of a user's own second factor.
 *
 * Every method here runs behind an authenticated session; completing a *login*
 * with a second factor lives in `AuthService`, which is what mints tokens.
 */
@Injectable()
export class MfaService {
  private readonly log = new Logger(MfaService.name);

  constructor(
    private readonly userMfaRepository: UserMfaRepository,
    private readonly userRepository: UserRepository,
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly totpService: TotpService,
    private readonly backupCodeService: BackupCodeService,
    private readonly mfaVerificationService: MfaVerificationService,
    private readonly mfaChallengeService: MfaChallengeService,
    private readonly secretCipherService: SecretCipherService,
    private readonly emailService: EmailService,
  ) {}

  async getStatus(
    user: AuthenticatedRequestUser,
  ): Promise<ApiSuccessResponse<MfaStatusPayload>> {
    const record = await this.userMfaRepository.findByUserIdWithSecrets(
      user.userId,
    );
    return {
      success: true,
      message: 'OK',
      data: buildStatus(record),
    };
  }

  /**
   * Step one of enrollment: hand out a secret and a QR code, but leave the
   * account unprotected until a generated code proves the app is set up.
   */
  async startTotpEnrollment(
    user: AuthenticatedRequestUser,
  ): Promise<ApiSuccessResponse<TotpEnrollmentPayload>> {
    const existing = await this.userMfaRepository.findByUserId(user.userId);
    if (existing?.isTotpEnabled === true) {
      throw new ConflictException(
        'Two-factor authentication is already enabled. Disable it first to enroll a new device.',
      );
    }

    const secret = this.totpService.generateSecret();
    const otpauthUri = this.totpService.buildKeyUri(user.email, secret);
    const qrCodeDataUrl = await this.totpService.buildQrCodeDataUrl(otpauthUri);
    const expiresAt = new Date(Date.now() + ENROLLMENT_TTL_MS);

    await this.userMfaRepository.startTotpEnrollment({
      userId: user.userId,
      tenantId: user.tenantId,
      pendingTotpSecretEncrypted: this.secretCipherService.encrypt(secret),
      pendingTotpExpiresAt: expiresAt,
    });

    return {
      success: true,
      message:
        'Scan the QR code with your authenticator app, then confirm the 6-digit code.',
      data: {
        secret,
        otpauthUri,
        qrCodeDataUrl,
        expiresAt: expiresAt.toISOString(),
      },
    };
  }

  /** Step two: confirm the app works, activate, and hand back recovery codes. */
  async enableTotp(
    user: AuthenticatedRequestUser,
    dto: EnableTotpDto,
  ): Promise<ApiSuccessResponse<BackupCodesPayload>> {
    const record = await this.userMfaRepository.findByUserIdWithSecrets(
      user.userId,
    );
    if (record?.isTotpEnabled === true) {
      throw new ConflictException(
        'Two-factor authentication is already enabled.',
      );
    }

    const pendingSecret = record?.pendingTotpSecretEncrypted;
    const pendingExpiresAt = record?.pendingTotpExpiresAt;
    if (pendingSecret === undefined || pendingSecret.length === 0) {
      throw new UnauthorizedException(
        'Start setup again — no pending authenticator enrollment was found.',
      );
    }
    if (
      pendingExpiresAt !== undefined &&
      pendingExpiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException(
        'This setup request expired. Start setup again to get a new QR code.',
      );
    }

    const confirmed = await this.totpService.verify(
      dto.code,
      this.secretCipherService.decrypt(pendingSecret),
    );
    if (confirmed === null) {
      throw new UnauthorizedException(
        'That code did not match. Check your authenticator app and try again.',
      );
    }

    const { plainCodes, hashedCodes } = this.backupCodeService.generate();
    const activated = await this.userMfaRepository.activateTotp({
      userId: user.userId,
      totpSecretEncrypted: pendingSecret,
      backupCodes: hashedCodes,
    });
    if (activated === null) {
      throw new UnauthorizedException(
        'Start setup again — no pending authenticator enrollment was found.',
      );
    }

    this.log.log(`TOTP enabled for user ${user.userId}`);
    await this.notifySecurityChange(user.email, {
      subjectLine: 'Two-factor authentication is on',
      headline: 'Two-factor authentication is now on',
      bodyLines: [
        'An authenticator app was added to your account. New sign-ins will ask for a 6-digit code after your password.',
        'A fresh set of recovery codes was issued at the same time. Any codes from an earlier set no longer work.',
      ],
    });
    return {
      success: true,
      message:
        'Two-factor authentication is on. Save these recovery codes — they are shown only once.',
      data: {
        backupCodes: plainCodes,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Requires the password *and* a current second factor: a stolen session alone
   * must not be enough to strip protection off the account.
   */
  async disableTotp(
    user: AuthenticatedRequestUser,
    dto: DisableTotpDto,
  ): Promise<ApiSuccessResponse<MfaStatusPayload>> {
    const record = await this.userMfaRepository.findByUserId(user.userId);
    if (record?.isTotpEnabled !== true) {
      throw new ConflictException(
        'Two-factor authentication is not enabled for this account.',
      );
    }

    await this.assertPasswordMatches(user, dto.password);
    const method = await this.mfaVerificationService.verify(
      user.userId,
      dto.code,
    );
    if (method === null) {
      throw new UnauthorizedException(
        'That code did not match. Use your authenticator app or a recovery code.',
      );
    }

    await this.userMfaRepository.disableTotp(user.userId);
    await this.mfaChallengeService.clearForUser(user.userId);

    // Removing the second factor is the highest-risk change on an account, so
    // every existing session is dropped and must sign in again.
    const revoked = await this.refreshTokenRepository.deleteByUserId(
      user.userId,
    );
    this.log.log(
      `TOTP disabled for user ${user.userId}; revoked ${revoked} session(s)`,
    );

    await this.notifySecurityChange(user.email, {
      subjectLine: 'Two-factor authentication is off',
      headline: 'Two-factor authentication was turned off',
      bodyLines: [
        'Your account no longer asks for a code from an authenticator app after your password.',
        'Every session was signed out as part of this change, and your recovery codes were discarded.',
      ],
    });

    const updated = await this.userMfaRepository.findByUserIdWithSecrets(
      user.userId,
    );
    return {
      success: true,
      message:
        'Two-factor authentication is off. You have been signed out on all devices.',
      data: buildStatus(updated),
    };
  }

  async regenerateBackupCodes(
    user: AuthenticatedRequestUser,
    dto: RegenerateBackupCodesDto,
  ): Promise<ApiSuccessResponse<BackupCodesPayload>> {
    const record = await this.userMfaRepository.findByUserId(user.userId);
    if (record?.isTotpEnabled !== true) {
      throw new ConflictException(
        'Enable two-factor authentication before generating recovery codes.',
      );
    }
    await this.assertPasswordMatches(user, dto.password);

    const { plainCodes, hashedCodes } = this.backupCodeService.generate();
    await this.userMfaRepository.replaceBackupCodes(user.userId, hashedCodes);

    this.log.log(`Backup codes regenerated for user ${user.userId}`);
    await this.notifySecurityChange(user.email, {
      subjectLine: 'New recovery codes were generated',
      headline: 'Your recovery codes were replaced',
      bodyLines: [
        'A new set of recovery codes was generated for your account.',
        'The previous codes stopped working immediately. If you saved them somewhere, replace them with the new set.',
      ],
    });
    return {
      success: true,
      message:
        'New recovery codes generated. Your previous codes no longer work.',
      data: {
        backupCodes: plainCodes,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  async updatePreferences(
    user: AuthenticatedRequestUser,
    dto: UpdateMfaPreferencesDto,
  ): Promise<ApiSuccessResponse<MfaStatusPayload>> {
    await this.userMfaRepository.setEmailCodeLoginEnabled(
      user.userId,
      user.tenantId,
      dto.isEmailCodeLoginEnabled,
    );
    const updated = await this.userMfaRepository.findByUserIdWithSecrets(
      user.userId,
    );
    return {
      success: true,
      message: 'Security preferences updated.',
      data: buildStatus(updated),
    };
  }

  /**
   * Best-effort alarm to the account owner. A mail failure must never roll back
   * a security change the user just made and saw succeed.
   */
  private async notifySecurityChange(
    email: string,
    content: { subjectLine: string; headline: string; bodyLines: string[] },
  ): Promise<void> {
    try {
      await this.emailService.sendSecurityChangeEmail({ to: email, ...content });
    } catch (error: unknown) {
      this.log.error(
        `Failed to send security notification to ${email}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  private async assertPasswordMatches(
    user: AuthenticatedRequestUser,
    password: string,
  ): Promise<void> {
    const account = await this.userRepository.findByEmailWithCredentials(
      user.email,
    );
    if (!account?.passwordHash) {
      throw new UnauthorizedException('Password confirmation failed.');
    }
    const matches = await bcrypt.compare(password, account.passwordHash);
    if (!matches) {
      throw new UnauthorizedException('Password confirmation failed.');
    }
  }
}

function buildStatus(record: UserMfaDocument | null): MfaStatusPayload {
  const pendingExpiresAt = record?.pendingTotpExpiresAt;
  const hasPendingEnrollment =
    (record?.pendingTotpSecretEncrypted ?? '').length > 0 &&
    (pendingExpiresAt === undefined || pendingExpiresAt.getTime() > Date.now());

  return {
    isTotpEnabled: record?.isTotpEnabled === true,
    totpEnabledAt: record?.totpEnabledAt?.toISOString() ?? null,
    hasPendingEnrollment,
    backupCodesRemaining: (record?.backupCodes ?? []).filter(
      (code) => code.usedAt === undefined || code.usedAt === null,
    ).length,
    isEmailCodeLoginEnabled: record?.isEmailCodeLoginEnabled !== false,
  };
}
