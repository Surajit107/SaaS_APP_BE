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
  configureHttpApp(app);

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  const localBase = `http://localhost:${port}`;
  logger.log(`REST API base: ${localBase}/api`);
  logger.log(`Swagger UI (call APIs here): ${localBase}/api/docs`);
  logger.log(`OpenAPI spec: ${localBase}/api/docs/json`);
}

void bootstrap();
