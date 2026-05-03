/**
 * Seeds the first platform operator by mutating the `users` collection only — never inserts or updates
 * `tenants`. The operator has `isPlatformAdmin` and `tenantId: ''` (no org row). Idempotent for an
 * existing email. Never reachable over HTTP.
 *
 * Requires in .env: PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../app.module';
import { UserRepository } from '../user/repositories/user.repository';

const BCRYPT_ROUNDS = 12;

async function bootstrap(): Promise<void> {
  const logger = new Logger('SeedPlatformAdmin');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const config = app.get(ConfigService);
    const emailRaw = config.get<string>('PLATFORM_ADMIN_EMAIL');
    const password = config.get<string>('PLATFORM_ADMIN_PASSWORD');
    if (!emailRaw?.trim() || !password?.trim()) {
      logger.error(
        'Set PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD in .env',
      );
      process.exitCode = 1;
      return;
    }
    const email = emailRaw.toLowerCase().trim();

    const userRepo = app.get(UserRepository);

    const existing = await userRepo.findByEmail(email);
    if (existing) {
      const hadWrongScope =
        !existing.isPlatformAdmin || (existing.tenantId ?? '').length > 0;
      await userRepo.ensurePlatformAdminNoTenant(existing._id.toString());
      if (hadWrongScope) {
        logger.log(
          `Platform admin ${email} updated (no tenant scope) — re-login for a fresh JWT.`,
        );
      } else {
        logger.log(
          `${email} is already a platform admin with no tenant scope.`,
        );
      }
      return;
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await userRepo.createUser({
      tenantId: '',
      email,
      passwordHash,
    });
    await userRepo.ensurePlatformAdminNoTenant(user._id.toString());
    logger.log(
      `Created platform admin ${email} (tenantId empty; not tied to an organization document).`,
    );
  } finally {
    await app.close();
  }
}

void bootstrap().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
