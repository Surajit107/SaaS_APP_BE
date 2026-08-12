import 'tsconfig-paths/register';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { configureHttpApp } from './bootstrap/http-app.config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  app.use(cookieParser());
  configureTrustProxy(app);
  configureHttpApp(app);

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  const localBase = `http://localhost:${port}`;
  logger.log(`REST API base: ${localBase}/api`);
  logger.log(`Swagger UI (call APIs here): ${localBase}/api/docs`);
  logger.log(`OpenAPI spec: ${localBase}/api/docs/json`);
}

/**
 * Behind a proxy (ngrok, a load balancer), every request arrives from the
 * proxy's IP. Without this, rate limiting would treat all clients as one.
 *
 * `TRUST_PROXY_HOPS` is the number of proxies in front of this server; leave it
 * unset when the app is reached directly.
 */
function configureTrustProxy(app: NestExpressApplication): void {
  const hops = Number.parseInt(process.env.TRUST_PROXY_HOPS ?? '', 10);
  if (!Number.isFinite(hops) || hops <= 0) {
    return;
  }
  app.set('trust proxy', hops);
  new Logger('Bootstrap').log(
    `Trusting ${hops} proxy hop(s) for client IP resolution`,
  );
}

void bootstrap();
