import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateSecret, generateURI, verify } from 'otplib';
import { toDataURL } from 'qrcode';

/** RFC 6238 defaults, which is what every mainstream authenticator app assumes. */
const PERIOD_SECONDS = 30;
const DIGITS = 6;

/**
 * Clock-drift allowance in seconds, on either side of now. One period each way
 * is the usual balance between tolerating a phone with a slightly wrong clock
 * and keeping the guessable window small.
 */
const EPOCH_TOLERANCE_SECONDS = PERIOD_SECONDS;

export interface TotpVerificationResult {
  /** Time step the code belonged to, recorded to block replay of the same code. */
  step: number;
}

@Injectable()
export class TotpService {
  private readonly log = new Logger(TotpService.name);

  constructor(private readonly configService: ConfigService) {}

  generateSecret(): string {
    return generateSecret();
  }

  /**
   * `otpauth://` URI consumed by authenticator apps. The issuer is what the
   * user sees as the account name in their app, so it should name this product.
   */
  buildKeyUri(accountEmail: string, secret: string): string {
    return generateURI({
      issuer: this.getIssuer(),
      label: accountEmail,
      secret,
      digits: DIGITS,
      period: PERIOD_SECONDS,
    });
  }

  async buildQrCodeDataUrl(otpauthUri: string): Promise<string> {
    return toDataURL(otpauthUri, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 240,
    });
  }

  /**
   * Returns the matched time step, or `null` when the code is wrong.
   *
   * Pass `afterTimeStep` (the last step already accepted for this user) to
   * reject a code that was captured and replayed while still inside its
   * validity window.
   */
  async verify(
    code: string,
    secret: string,
    afterTimeStep?: number,
  ): Promise<TotpVerificationResult | null> {
    const normalized = normalizeCode(code);
    if (normalized.length !== DIGITS) {
      return null;
    }
    try {
      const result = await verify({
        secret,
        token: normalized,
        digits: DIGITS,
        period: PERIOD_SECONDS,
        epochTolerance: EPOCH_TOLERANCE_SECONDS,
        ...(afterTimeStep !== undefined ? { afterTimeStep } : {}),
      });
      // `verify` is shared with HOTP, whose result carries no time step.
      // The TOTP strategy always supplies one.
      if (!result.valid || !('timeStep' in result)) {
        return null;
      }
      return { step: result.timeStep };
    } catch (error: unknown) {
      // A corrupted secret (e.g. left over from a rotated encryption key) or an
      // out-of-range replay marker should read as a failed attempt, not a 500
      // on the login path.
      this.log.warn(
        `TOTP verification failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private getIssuer(): string {
    const configured = (
      this.configService.get<string>('MFA_TOTP_ISSUER') ??
      this.configService.get<string>('PLATFORM_BRAND_NAME') ??
      ''
    ).trim();
    return configured.length > 0 ? configured : 'SaaS Application';
  }
}

export function normalizeCode(code: string): string {
  return code.replace(/\D/g, '');
}
