import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';

/**
 * Shared HTTP stack (prefix, validation, errors, Swagger). Use from `main.ts` and e2e.
 */
export function configureHttpApp(app: INestApplication): void {
  app.setGlobalPrefix('api', {
    exclude: [{ path: 'stripe/webhook', method: RequestMethod.POST }],
  });
  const corsConfig = getCorsConfigFromEnv();
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      if (origin === undefined) {
        callback(null, true);
        return;
      }
      if (isOriginAllowed(origin, corsConfig)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS blocked for origin: ${origin}`), false);
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'ngrok-skip-browser-warning'],
    optionsSuccessStatus: 204,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('SaaS API')
    .setDescription('Modular SaaS backend — grouped by domain module')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        description: 'Paste the access token from login or refresh',
        in: 'header',
      },
      'access-token',
    )
    .addTag('Health', 'Application health')
    .addTag('Auth', 'Authentication and identity')
    .addTag('Platform admin', 'Platform operator (cross-tenant) APIs')
    .addTag('User', 'End users and profiles')
    .addTag('Billing', 'Subscriptions and billing')
    .addTag('Workspace', 'Workspaces')
    .addTag('File', 'File metadata and storage')
    .addTag('Notification', 'Notifications')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    useGlobalPrefix: true,
    jsonDocumentUrl: 'docs/json',
    yamlDocumentUrl: 'docs/yaml',
  });
}

type CorsConfig = {
  exactOrigins: string[];
  wildcardPatterns: RegExp[];
};

function getCorsConfigFromEnv(): CorsConfig {
  const rawOrigins =
    process.env.CORS_ALLOWED_ORIGINS ??
    process.env.AUTH_CORS_ORIGINS ??
    process.env.CORS_ORIGINS ??
    process.env.FRONTEND_HOST ??
    '';
  const configuredOrigins = rawOrigins
    .split(',')
    .map((value) => normalizeOrigin(value))
    .filter((value): value is string => value !== null)
    .filter((value) => value.length > 0);

  const configuredPatternRegex = parseOriginPatterns(
    process.env.CORS_ALLOWED_ORIGIN_PATTERNS ?? '',
  );

  if (process.env.NODE_ENV === 'production') {
    return {
      exactOrigins: configuredOrigins,
      wildcardPatterns: configuredPatternRegex,
    };
  }

  const devDefaultOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ]
    .map((value) => normalizeOrigin(value))
    .filter((value): value is string => value !== null);

  const devPatternRegex = parseOriginPatterns(
    'http://localhost:*,http://127.0.0.1:*,https://*.ngrok-free.app',
  );

  return {
    exactOrigins: Array.from(new Set([...configuredOrigins, ...devDefaultOrigins])),
    wildcardPatterns: [...configuredPatternRegex, ...devPatternRegex],
  };
}

function isOriginAllowed(origin: string, config: CorsConfig): boolean {
  const normalizedOrigin = normalizeOrigin(origin);
  if (normalizedOrigin === null) {
    return false;
  }
  if (config.exactOrigins.length === 0 && config.wildcardPatterns.length === 0) {
    return true;
  }
  if (config.exactOrigins.includes(normalizedOrigin)) {
    return true;
  }
  return config.wildcardPatterns.some((pattern) => pattern.test(normalizedOrigin));
}

function parseOriginPatterns(raw: string): RegExp[] {
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map((value) => wildcardToRegex(value))
    .filter((value): value is RegExp => value !== null);
}

function wildcardToRegex(value: string): RegExp | null {
  const normalized = normalizeOrigin(value);
  if (normalized === null) {
    return null;
  }
  const regexBody = normalized
    .split('*')
    .map((segment) => segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  try {
    return new RegExp(`^${regexBody}$`);
  } catch {
    return null;
  }
}

function normalizeOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}
