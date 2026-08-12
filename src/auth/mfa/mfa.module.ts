import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { MfaChallengeRepository } from './repositories/mfa-challenge.repository';
import { UserMfaRepository } from './repositories/user-mfa.repository';
import {
  MfaChallenge,
  MfaChallengeSchema,
} from './schemas/mfa-challenge.schema';
import { UserMfa, UserMfaSchema } from './schemas/user-mfa.schema';
import { BackupCodeService } from './services/backup-code.service';
import { EmailCodeService } from './services/email-code.service';
import { MfaChallengeService } from './services/mfa-challenge.service';
import { MfaVerificationService } from './services/mfa-verification.service';
import { TotpService } from './services/totp.service';

/**
 * Multi-factor persistence and code mechanics.
 *
 * Deliberately free of auth dependencies so `AuthModule` can consume it without
 * a circular import. Anything needing `UserRepository` or session revocation
 * (enrollment, login completion) lives in `AuthModule` instead.
 */
@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: UserMfa.name, schema: UserMfaSchema },
      { name: MfaChallenge.name, schema: MfaChallengeSchema },
    ]),
  ],
  providers: [
    UserMfaRepository,
    MfaChallengeRepository,
    TotpService,
    BackupCodeService,
    EmailCodeService,
    MfaChallengeService,
    MfaVerificationService,
  ],
  exports: [
    UserMfaRepository,
    MfaChallengeRepository,
    TotpService,
    BackupCodeService,
    EmailCodeService,
    MfaChallengeService,
    MfaVerificationService,
  ],
})
export class MfaModule {}
