/**
 * health.e2e-spec.ts — E2E tests for the HealthModule endpoints.
 *
 * Uses a mocked PrismaService to test the full HTTP pipeline (middleware,
 * interceptors, filters, routing) without requiring a live database.
 * Prisma 7 loads a WASM query compiler via dynamic ESM import(), which is
 * incompatible with Jest's CJS runtime — mocking avoids this entirely.
 *
 * Run: npm run test:e2e -- --testPathPattern=health
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { PrismaService } from '../src/prisma/prisma.service';

/** Minimal mock of PrismaService — avoids Prisma 7 WASM loading in Jest. */
const mockPrismaService = {
  $connect: jest.fn().mockResolvedValue(undefined),
  $disconnect: jest.fn().mockResolvedValue(undefined),
  /** Tagged-template call from HealthController — simulates a healthy DB. */
  $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
  systemConfig: {
    /** Called by SystemConfigService.onModuleInit — returns empty cache. */
    findMany: jest.fn().mockResolvedValue([]),
  },
  // SafetyModule — SafetyRepository.findAllRules / findAllBlacklist
  safetyRule: {
    findMany: jest.fn().mockResolvedValue([]),
  },
  blacklistEntry: {
    findMany: jest.fn().mockResolvedValue([]),
  },
  // IntentModule — IntentRepository.findAllTemplates / findAllGlossary
  intentTemplate: {
    findMany: jest.fn().mockResolvedValue([]),
  },
  glossaryTerm: {
    findMany: jest.fn().mockResolvedValue([]),
  },
  // KnowledgeModule — no onModuleInit, but cover any incidental calls
  knowledgeEntry: {
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn().mockResolvedValue(null),
  },
};

describe('HealthController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrismaService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/v1/health', () => {
    it('should return 200 with status ok when DB is reachable', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);

      expect(res.body.data).toEqual({ status: 'ok', db: 'ok' });
      expect(res.body.code).toBe(200);
      expect(typeof res.body.requestId).toBe('string');
    });

    it('should include X-Request-ID header in the response', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/health');

      expect(res.headers['x-request-id']).toBeDefined();
    });

    it('should echo back a supplied X-Request-ID', async () => {
      const suppliedId = 'my-custom-request-id-123';
      const res = await request(app.getHttpServer())
        .get('/api/v1/health')
        .set('X-Request-ID', suppliedId);

      expect(res.headers['x-request-id']).toBe(suppliedId);
      expect(res.body.requestId).toBe(suppliedId);
    });
  });

  describe('GET /api/v1/health/ai-status', () => {
    it('should return 200 with aiStatus: "normal" on fresh boot', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/health/ai-status')
        .expect(200);

      expect(res.body.data).toEqual({ aiStatus: 'normal' });
      expect(res.body.code).toBe(200);
    });
  });
});
