import { ConfigService } from '@nestjs/config';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';

const DEFAULT_TTL_SECONDS = 60;
const DEFAULT_LIMIT = 120;

/**
 * Baseline request ceiling. Routes that need a tighter budget (auth, one-time
 * codes) override it per handler with `@Throttle({ default: { ... } })`.
 *
 * Set `THROTTLE_DISABLED=true` to bypass limits in tests and local debugging.
 */
export function buildThrottlerOptions(
  configService: ConfigService,
): ThrottlerModuleOptions {
  return {
    throttlers: [
      {
        name: 'default',
        ttl:
          readPositiveInteger(
            configService,
            'THROTTLE_TTL_SECONDS',
            DEFAULT_TTL_SECONDS,
          ) * 1000,
        limit: readPositiveInteger(
          configService,
          'THROTTLE_LIMIT',
          DEFAULT_LIMIT,
        ),
      },
    ],
    errorMessage: 'Too many requests. Please wait a moment and try again.',
    skipIf: () =>
      (configService.get<string>('THROTTLE_DISABLED') ?? '')
        .trim()
        .toLowerCase() === 'true',
  };
}

function readPositiveInteger(
  configService: ConfigService,
  key: string,
  fallback: number,
): number {
  const parsed = Number.parseInt(configService.get<string>(key) ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
