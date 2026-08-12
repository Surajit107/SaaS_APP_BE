import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SecretCipherKeyError,
  decryptSecret,
  deriveLookupHash,
  encryptSecret,
  parseEncryptionKey,
} from './secret-cipher.util';

export const SECRET_ENCRYPTION_KEY_ENV = 'SECRET_ENCRYPTION_KEY';

/**
 * Encrypts secrets that must be recoverable (TOTP shared secrets).
 *
 * The key is resolved lazily so a server missing `SECRET_ENCRYPTION_KEY` still
 * boots — only the features that need it fail, with an actionable message.
 */
@Injectable()
export class SecretCipherService {
  private readonly log = new Logger(SecretCipherService.name);
  private cachedKey: Buffer | null = null;
  private hasWarned = false;

  constructor(private readonly configService: ConfigService) {}

  isConfigured(): boolean {
    try {
      this.resolveKey();
      return true;
    } catch {
      return false;
    }
  }

  encrypt(plaintext: string): string {
    return encryptSecret(plaintext, this.resolveKey());
  }

  decrypt(payload: string): string {
    return decryptSecret(payload, this.resolveKey());
  }

  /** Keyed digest for high-entropy single-use codes. See `deriveLookupHash`. */
  hashLookupValue(value: string): string {
    return deriveLookupHash(value, this.resolveKey());
  }

  private resolveKey(): Buffer {
    if (this.cachedKey !== null) {
      return this.cachedKey;
    }
    try {
      this.cachedKey = parseEncryptionKey(
        this.configService.get<string>(SECRET_ENCRYPTION_KEY_ENV),
      );
      return this.cachedKey;
    } catch (error: unknown) {
      if (error instanceof SecretCipherKeyError) {
        this.warnOnce(error.message);
        throw new InternalServerErrorException(
          `${SECRET_ENCRYPTION_KEY_ENV} is missing or invalid. Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
        );
      }
      throw error;
    }
  }

  private warnOnce(message: string): void {
    if (this.hasWarned) {
      return;
    }
    this.hasWarned = true;
    this.log.error(
      `${message} Features relying on encrypted secrets are disabled.`,
    );
  }
}
