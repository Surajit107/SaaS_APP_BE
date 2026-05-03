import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureHttpApp } from './../src/bootstrap/http-app.config';
import { AppModule } from './../src/app.module';

describe('App (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(() => {
    process.env.MONGODB_URI =
      process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/saas_app_e2e';
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ??
      'e2e_jwt_access_secret_at_least_32_characters_long';
  });

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureHttpApp(app);
    await app.init();
  });

  it('GET /api', () => {
    return request(app.getHttpServer())
      .get('/api')
      .expect(200)
      .expect((res) => {
        const body = res.body as {
          success: boolean;
          data?: { docs?: string };
        };
        expect(body.success).toBe(true);
        expect(body.data?.docs).toBe('/api/docs');
      });
  });

  it('GET /api/health', () => {
    return request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect((res) => {
        const body = res.body as {
          success: boolean;
          data?: { status?: string };
        };
        expect(body.success).toBe(true);
        expect(body.data?.status).toBe('up');
      });
  });

  it('GET /api/docs/json returns OpenAPI document', () => {
    return request(app.getHttpServer())
      .get('/api/docs/json')
      .expect(200)
      .expect('Content-Type', /json/)
      .expect((res) => {
        const body = res.body as { openapi?: string; paths?: object };
        expect(body.openapi).toBeDefined();
        expect(body.paths).toBeDefined();
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
