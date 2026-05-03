import { ConfigService } from '@nestjs/config';
import { CookieOptions } from 'express';

export const ACCESS_TOKEN_COOKIE = 'accessToken';
export const REFRESH_TOKEN_COOKIE = 'refreshToken';

interface AuthCookieOptions {
  access: CookieOptions;
  refresh: CookieOptions;
}

const ONE_SECOND_MS = 1000;
const ONE_DAY_MS = 24 * 60 * 60 * ONE_SECOND_MS;

function parseBoolean(raw: string | undefined): boolean | null {
  if (raw === undefined) {
    return null;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === '0') {
    return false;
  }
  return null;
}

function resolveSameSite(
  raw: string | undefined,
): CookieOptions['sameSite'] | undefined {
  if (raw === undefined) {
    return 'lax';
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'strict') return 'strict';
  if (normalized === 'lax') return 'lax';
  if (normalized === 'none') return 'none';
  return 'lax';
}

function getRefreshTtlMs(configService: ConfigService): number {
  const daysRaw = configService.get<string>('JWT_REFRESH_EXPIRES_DAYS', '7');
  const days = Number.parseInt(daysRaw, 10);
  const safeDays = Number.isFinite(days) && days > 0 ? days : 7;
  return safeDays * ONE_DAY_MS;
}

export function buildAuthCookieOptions(
  configService: ConfigService,
  accessExpiresInSeconds: number,
): AuthCookieOptions {
  const explicitSecure = parseBoolean(
    configService.get<string>('AUTH_COOKIE_SECURE'),
  );
  const secure =
    explicitSecure ?? configService.get<string>('NODE_ENV') === 'production';
  const sameSite = resolveSameSite(
    configService.get<string>('AUTH_COOKIE_SAME_SITE'),
  );
  const domain = configService.get<string>('AUTH_COOKIE_DOMAIN');
  const shared: CookieOptions = {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
  };
  if (domain !== undefined && domain.trim().length > 0) {
    shared.domain = domain.trim();
  }

  return {
    access: {
      ...shared,
      maxAge: accessExpiresInSeconds * ONE_SECOND_MS,
    },
    refresh: {
      ...shared,
      path: '/api/auth/refresh',
      maxAge: getRefreshTtlMs(configService),
    },
  };
}

export function buildAuthCookieClearOptions(
  configService: ConfigService,
): AuthCookieOptions {
  const base = buildAuthCookieOptions(configService, 60);
  const stripMaxAge = (options: CookieOptions): CookieOptions => {
    const copy: CookieOptions = { ...options };
    delete copy.maxAge;
    return copy;
  };
  return {
    access: stripMaxAge(base.access),
    refresh: stripMaxAge(base.refresh),
  };
}
