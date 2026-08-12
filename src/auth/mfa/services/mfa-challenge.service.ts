import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomBytes, randomUUID } from 'node:crypto';
import type {
  AuthLoginScope,
  TenantLoginPortalRole,
} from '../../dto/login.dto';
import { MfaChallengeRepository } from '../repositories/mfa-challenge.repository';
import type {
  MfaChallengeDocument,
  MfaChallengePurpose,
} from '../schemas/mfa-challenge.schema';

const BCRYPT_ROUNDS = 12;
const DEFAULT_TTL_MINUTES = 5;
const DEFAULT_MAX_ATTEMPTS = 5;

export interface IssueChallengeInput {
  userId?: string;
  tenantId: string;
  purpose: MfaChallengePurpose;
  authScope: AuthLoginScope;
  tenantRole?: TenantLoginPortalRole;
  /** bcrypt hash of an emailed one-time code; omitted for authenticator challenges. */
  codeHash?: string;
  ttlMinutes?: number;
}

export interface IssuedChallenge {
  challengeToken: string;
  expiresAt: Date;
}

/**
 * Owns the short-lived "you passed the first factor, now prove the second"
 * ticket. Everything needed to finish the login is captured at issue time, so
 * the second request cannot change the scope or role it was granted under.
 */
@Injectable()
export class MfaChallengeService {
  constructor(
    private readonly mfaChallengeRepository: MfaChallengeRepository,
    private readonly configService: ConfigService,
  ) {}

  async issue(input: IssueChallengeInput): Promise<IssuedChallenge> {
    const jti = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    const secretHash = await bcrypt.hash(secret, BCRYPT_ROUNDS);
    const expiresAt = new Date(
      Date.now() + (input.ttlMinutes ?? this.getTtlMinutes()) * 60_000,
    );

    await this.mfaChallengeRepository.create({
      jti,
      secretHash,
      userId: input.userId,
      tenantId: input.tenantId,
      purpose: input.purpose,
      authScope: input.authScope,
      tenantRole: input.tenantRole,
      codeHash: input.codeHash,
      maxAttempts: this.getMaxAttempts(),
      expiresAt,
    });

    return { challengeToken: `${jti}.${secret}`, expiresAt };
  }

  /**
   * Resolves a challenge token to its record, rejecting anything expired,
   * already spent, or out of attempts. Every failure path returns the same
   * generic message so a caller learns nothing from probing.
   */
  async load(challengeToken: string): Promise<MfaChallengeDocument> {
    const parsed = parseChallengeToken(challengeToken);
    if (parsed === null) {
      throw new UnauthorizedException(INVALID_CHALLENGE_MESSAGE);
    }

    const challenge = await this.mfaChallengeRepository.findByJtiWithCode(
      parsed.jti,
    );
    if (!challenge) {
      throw new UnauthorizedException(INVALID_CHALLENGE_MESSAGE);
    }
    if (challenge.consumedAt !== undefined && challenge.consumedAt !== null) {
      throw new UnauthorizedException(INVALID_CHALLENGE_MESSAGE);
    }
    if (challenge.expiresAt.getTime() <= Date.now()) {
      await this.mfaChallengeRepository.deleteByJti(parsed.jti);
      throw new UnauthorizedException(
        'This verification request has expired. Please sign in again.',
      );
    }
    if (challenge.attemptCount >= challenge.maxAttempts) {
      await this.mfaChallengeRepository.deleteByJti(parsed.jti);
      throw new UnauthorizedException(TOO_MANY_ATTEMPTS_MESSAGE);
    }

    const secretMatches = await bcrypt.compare(
      parsed.secret,
      challenge.secretHash,
    );
    if (!secretMatches) {
      throw new UnauthorizedException(INVALID_CHALLENGE_MESSAGE);
    }
    return challenge;
  }

  /**
   * Counts a wrong code against the challenge and destroys it once the budget
   * is gone, forcing the user back through the first factor. This is the cap
   * that actually protects a 6-digit code; per-IP throttling alone would let an
   * attacker keep guessing from new addresses.
   */
  async registerFailedAttempt(challenge: MfaChallengeDocument): Promise<never> {
    const attemptCount = await this.mfaChallengeRepository.recordFailedAttempt(
      challenge.jti,
    );
    const used = attemptCount ?? challenge.maxAttempts;
    const remaining = Math.max(challenge.maxAttempts - used, 0);

    if (remaining === 0) {
      await this.mfaChallengeRepository.deleteByJti(challenge.jti);
      throw new UnauthorizedException(TOO_MANY_ATTEMPTS_MESSAGE);
    }
    throw new UnauthorizedException(
      `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
    );
  }

  /** Single-use: only the first caller to consume a challenge may finish the login. */
  async consume(challenge: MfaChallengeDocument): Promise<void> {
    const won = await this.mfaChallengeRepository.tryConsume(challenge.jti);
    if (!won) {
      throw new UnauthorizedException(INVALID_CHALLENGE_MESSAGE);
    }
  }

  /** Drops any other pending challenges, e.g. after a successful sign-in. */
  async clearForUser(userId: string): Promise<void> {
    await this.mfaChallengeRepository.deleteByUserId(userId);
  }

  private getTtlMinutes(): number {
    return readPositiveInteger(
      this.configService,
      'MFA_CHALLENGE_TTL_MINUTES',
      DEFAULT_TTL_MINUTES,
    );
  }

  private getMaxAttempts(): number {
    return readPositiveInteger(
      this.configService,
      'MFA_MAX_VERIFY_ATTEMPTS',
      DEFAULT_MAX_ATTEMPTS,
    );
  }
}

const INVALID_CHALLENGE_MESSAGE =
  'This verification request is no longer valid. Please sign in again.';
const TOO_MANY_ATTEMPTS_MESSAGE =
  'Too many incorrect codes. Please sign in again.';

function parseChallengeToken(
  raw: string,
): { jti: string; secret: string } | null {
  const parts = raw.trim().split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null;
  }
  const [jti, secret] = parts;
  return { jti, secret };
}

function readPositiveInteger(
  configService: ConfigService,
  key: string,
  fallback: number,
): number {
  const parsed = Number.parseInt(configService.get<string>(key) ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
