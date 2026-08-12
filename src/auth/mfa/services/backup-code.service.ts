import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { SecretCipherService } from '../../../common/crypto/secret-cipher.service';
import type { MfaBackupCode } from '../schemas/user-mfa.schema';

/** Crockford-style alphabet: no I, L, O, U, 0 or 1, so codes survive transcription. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 12;
const GROUP_SIZE = 4;
const CODE_COUNT = 10;

export interface GeneratedBackupCodes {
  /** Formatted for display; returned to the user exactly once. */
  plainCodes: string[];
  /** Keyed digests for storage. */
  hashedCodes: MfaBackupCode[];
}

/**
 * Single-use recovery codes for when the authenticator device is unavailable.
 *
 * 12 characters from a 30-symbol alphabet is roughly 59 bits of entropy, which
 * is why a keyed digest (rather than a slow KDF) is safe here — see
 * `deriveLookupHash`.
 */
@Injectable()
export class BackupCodeService {
  constructor(private readonly secretCipherService: SecretCipherService) {}

  generate(count: number = CODE_COUNT): GeneratedBackupCodes {
    const plainCodes = Array.from({ length: count }, () => this.createCode());
    const hashedCodes = plainCodes.map((code) => ({
      codeHash: this.hash(code),
    }));
    return { plainCodes, hashedCodes };
  }

  /** Hashes after normalizing, so display grouping and case never matter. */
  hash(code: string): string {
    return this.secretCipherService.hashLookupValue(normalizeBackupCode(code));
  }

  private createCode(): string {
    const characters = Array.from(
      { length: CODE_LENGTH },
      () => ALPHABET[randomInt(ALPHABET.length)],
    ).join('');

    const groups: string[] = [];
    for (let index = 0; index < characters.length; index += GROUP_SIZE) {
      groups.push(characters.slice(index, index + GROUP_SIZE));
    }
    return groups.join('-');
  }
}

export function normalizeBackupCode(code: string): string {
  return code.replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
}

export function looksLikeBackupCode(code: string): boolean {
  return normalizeBackupCode(code).length === CODE_LENGTH;
}
