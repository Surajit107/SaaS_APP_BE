import { Injectable } from '@nestjs/common';
import { SecretCipherService } from '../../../common/crypto/secret-cipher.service';
import { UserMfaRepository } from '../repositories/user-mfa.repository';
import type { MfaVerificationMethod } from '../types/mfa.types';
import { BackupCodeService, looksLikeBackupCode } from './backup-code.service';
import { TotpService, normalizeCode } from './totp.service';

/**
 * Checks a submitted second factor against a user's enrolled methods.
 *
 * Returns which method was accepted, or `null` for a failed attempt. Callers
 * are responsible for counting failures against the pending challenge.
 */
@Injectable()
export class MfaVerificationService {
  constructor(
    private readonly userMfaRepository: UserMfaRepository,
    private readonly totpService: TotpService,
    private readonly backupCodeService: BackupCodeService,
    private readonly secretCipherService: SecretCipherService,
  ) {}

  async verify(
    userId: string,
    submittedCode: string,
  ): Promise<MfaVerificationMethod | null> {
    const record = await this.userMfaRepository.findByUserIdWithSecrets(userId);
    if (!record || record.isTotpEnabled !== true) {
      return null;
    }

    // Length disambiguates the two formats, so a recovery code is never
    // consumed by a mistyped authenticator code and vice versa.
    if (looksLikeBackupCode(submittedCode)) {
      const spent = await this.userMfaRepository.markBackupCodeUsed(
        userId,
        this.backupCodeService.hash(submittedCode),
      );
      return spent ? 'backup_code' : null;
    }

    const encryptedSecret = record.totpSecretEncrypted;
    if (encryptedSecret === undefined || encryptedSecret.length === 0) {
      return null;
    }
    if (normalizeCode(submittedCode).length !== 6) {
      return null;
    }

    const result = await this.totpService.verify(
      submittedCode,
      this.secretCipherService.decrypt(encryptedSecret),
      record.lastUsedTotpStep,
    );
    if (result === null) {
      return null;
    }

    // A correct code is only accepted once. Losing this race means the same
    // code was already redeemed within its window.
    const claimed = await this.userMfaRepository.tryConsumeTotpStep(
      userId,
      result.step,
    );
    return claimed ? 'totp' : null;
  }
}
