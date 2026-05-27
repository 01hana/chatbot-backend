import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { DashboardAdminController } from './dashboard-admin.controller';
import { DashboardAdminService } from './dashboard-admin.service';

const mockStats = {
  todayConversations: 5,
  monthlyConversations: 80,
  aiResolutionRate: 0.9,
  pendingTickets: 3,
  monthlyLeads: 12,
  conversationTrend: [],
  intentDistribution: [],
  handoffReasonDistribution: [],
  latestAuditEvents: [],
};

const mockDashboardService = {
  getStats: jest.fn(),
};

describe('DashboardAdminController', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DashboardAdminController],
      providers: [{ provide: DashboardAdminService, useValue: mockDashboardService }],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await app.close();
  });

  // ── 1. No query params → 200 ─────────────────────────────────────────────

  it('should return 200 when no query params are provided', async () => {
    (mockDashboardService.getStats as jest.MockedFunction<typeof mockDashboardService.getStats>)
      .mockResolvedValue(mockStats as never);

    await request(app.getHttpServer())
      .get('/admin/dashboard')
      .expect(200);

    expect(mockDashboardService.getStats).toHaveBeenCalledWith(undefined);
  });

  // ── 2. Response contains all frontend Phase 3 fields ─────────────────────

  it('should return response with all required dashboard fields', async () => {
    (mockDashboardService.getStats as jest.MockedFunction<typeof mockDashboardService.getStats>)
      .mockResolvedValue(mockStats as never);

    const response = await request(app.getHttpServer())
      .get('/admin/dashboard')
      .expect(200);

    expect(response.body).toHaveProperty('todayConversations');
    expect(response.body).toHaveProperty('monthlyConversations');
    expect(response.body).toHaveProperty('aiResolutionRate');
    expect(response.body).toHaveProperty('pendingTickets');
    expect(response.body).toHaveProperty('monthlyLeads');
    expect(response.body).toHaveProperty('conversationTrend');
    expect(response.body).toHaveProperty('intentDistribution');
    expect(response.body).toHaveProperty('handoffReasonDistribution');
    expect(response.body).toHaveProperty('latestAuditEvents');
  });

  // ── 3. Optional month → 200 ───────────────────────────────────────────────

  it('should return 200 with valid month param', async () => {
    (mockDashboardService.getStats as jest.MockedFunction<typeof mockDashboardService.getStats>)
      .mockResolvedValue(mockStats as never);

    await request(app.getHttpServer())
      .get('/admin/dashboard?month=2026-01')
      .expect(200);

    expect(mockDashboardService.getStats).toHaveBeenCalledWith('2026-01');
  });

  // ── 4. Bad month format → 400 ─────────────────────────────────────────────

  it('should return 400 when month format is invalid', async () => {
    await request(app.getHttpServer())
      .get('/admin/dashboard?month=bad-format')
      .expect(400);
  });

  it('should return 400 when month is out of range (month 13)', async () => {
    await request(app.getHttpServer())
      .get('/admin/dashboard?month=2026-13')
      .expect(400);
  });

  // ── 5. Service 400 propagates ─────────────────────────────────────────────

  it('should propagate BadRequestException from service as 400', async () => {
    (mockDashboardService.getStats as jest.MockedFunction<typeof mockDashboardService.getStats>)
      .mockRejectedValue(new BadRequestException('invalid month') as never);

    await request(app.getHttpServer())
      .get('/admin/dashboard?month=2026-01')
      .expect(400);
  });
});
