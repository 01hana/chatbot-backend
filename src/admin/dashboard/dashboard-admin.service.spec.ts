import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DashboardAdminService } from './dashboard-admin.service';
import { PrismaService } from '../../prisma/prisma.service';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  conversation: { count: jest.fn() },
  lead: { count: jest.fn() },
  ticket: { count: jest.fn() },
  auditLog: { findMany: jest.fn() },
};

// ─── Utility ─────────────────────────────────────────────────────────────────

function setupZeroMocks() {
  (mockPrisma.conversation.count as jest.MockedFunction<typeof mockPrisma.conversation.count>)
    .mockResolvedValue(0 as never);
  (mockPrisma.lead.count as jest.MockedFunction<typeof mockPrisma.lead.count>)
    .mockResolvedValue(0 as never);
  (mockPrisma.ticket.count as jest.MockedFunction<typeof mockPrisma.ticket.count>)
    .mockResolvedValue(0 as never);
  (mockPrisma.auditLog.findMany as jest.MockedFunction<typeof mockPrisma.auditLog.findMany>)
    .mockResolvedValue([] as never);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DashboardAdminService', () => {
  let service: DashboardAdminService;

  // Fix the system time so month/today boundary tests are deterministic
  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-15T12:00:00.000Z'));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardAdminService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<DashboardAdminService>(DashboardAdminService);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getStats()', () => {
    // ── 1. Safe defaults ────────────────────────────────────────────────────

    it('should return safe defaults when there is no data', async () => {
      setupZeroMocks();

      const result = await service.getStats();

      expect(result.todayConversations).toBe(0);
      expect(result.monthlyConversations).toBe(0);
      expect(result.aiResolutionRate).toBe(0);
      expect(result.pendingTickets).toBe(0);
      expect(result.monthlyLeads).toBe(0);
      expect(result.conversationTrend).toEqual([]);
      expect(result.intentDistribution).toEqual([]);
      expect(result.handoffReasonDistribution).toEqual([]);
      expect(result.latestAuditEvents).toEqual([]);
    });

    // ── 2. monthlyConversations uses current month range ─────────────────────

    it('should pass current-month bounds when querying monthlyConversations', async () => {
      setupZeroMocks();
      await service.getStats();

      // conversation.count is called twice: todayConversations + monthlyConversations
      const calls = (mockPrisma.conversation.count as jest.MockedFunction<typeof mockPrisma.conversation.count>).mock.calls;
      expect(calls).toHaveLength(2);

      const monthlyCall = calls[1][0] as { where: { createdAt: { gte: Date; lte: Date } } };
      expect(monthlyCall.where.createdAt.gte).toEqual(new Date('2026-05-01T00:00:00.000Z'));
      // Month-end: 2026-05-31T23:59:59.999Z
      expect(monthlyCall.where.createdAt.lte.getUTCMonth()).toBe(4); // May = 4
      expect(monthlyCall.where.createdAt.lte.getUTCDate()).toBe(31);
    });

    // ── 3. todayConversations uses today range ────────────────────────────────

    it('should pass today bounds when querying todayConversations', async () => {
      setupZeroMocks();
      await service.getStats();

      const calls = (mockPrisma.conversation.count as jest.MockedFunction<typeof mockPrisma.conversation.count>).mock.calls;
      const todayCall = calls[0][0] as { where: { createdAt: { gte: Date; lte: Date } } };
      expect(todayCall.where.createdAt.gte).toEqual(new Date('2026-05-15T00:00:00.000Z'));
      expect(todayCall.where.createdAt.lte).toEqual(new Date('2026-05-15T23:59:59.999Z'));
    });

    // ── 4. pendingTickets queries open / in_progress ──────────────────────────

    it('should query pendingTickets with status in open / in_progress', async () => {
      setupZeroMocks();
      (mockPrisma.ticket.count as jest.MockedFunction<typeof mockPrisma.ticket.count>)
        .mockResolvedValueOnce(3 as never)  // pendingTickets
        .mockResolvedValueOnce(1 as never); // monthHandoffTickets

      const result = await service.getStats();

      const calls = (mockPrisma.ticket.count as jest.MockedFunction<typeof mockPrisma.ticket.count>).mock.calls;
      const pendingCall = calls[0][0] as { where: { status: { in: string[] } } };
      expect(pendingCall.where.status.in).toEqual(
        expect.arrayContaining(['open', 'in_progress']),
      );
      expect(result.pendingTickets).toBe(3);
    });

    // ── 5. monthlyLeads uses current month range ──────────────────────────────

    it('should pass current-month bounds when querying monthlyLeads', async () => {
      setupZeroMocks();
      await service.getStats();

      const call = (mockPrisma.lead.count as jest.MockedFunction<typeof mockPrisma.lead.count>).mock.calls[0][0] as {
        where: { createdAt: { gte: Date; lte: Date } };
      };
      expect(call.where.createdAt.gte).toEqual(new Date('2026-05-01T00:00:00.000Z'));
    });

    it('should return monthlyLeads from DB', async () => {
      setupZeroMocks();
      (mockPrisma.lead.count as jest.MockedFunction<typeof mockPrisma.lead.count>)
        .mockResolvedValue(7 as never);

      const result = await service.getStats();
      expect(result.monthlyLeads).toBe(7);
    });

    // ── 6. aiResolutionRate = 0 when monthlyConversations = 0 ─────────────────

    it('should return aiResolutionRate = 0 when monthlyConversations is 0', async () => {
      setupZeroMocks();

      const result = await service.getStats();
      expect(result.aiResolutionRate).toBe(0);
    });

    it('should calculate aiResolutionRate correctly', async () => {
      setupZeroMocks();
      // conversation.count returns 10 for today, 10 for monthly
      (mockPrisma.conversation.count as jest.MockedFunction<typeof mockPrisma.conversation.count>)
        .mockResolvedValue(10 as never);
      // ticket.count: pendingTickets=0, monthHandoffTickets=2
      (mockPrisma.ticket.count as jest.MockedFunction<typeof mockPrisma.ticket.count>)
        .mockResolvedValueOnce(0 as never)  // pendingTickets
        .mockResolvedValueOnce(2 as never); // monthHandoffTickets

      const result = await service.getStats();
      // (10 - 2) / 10 = 0.8
      expect(result.aiResolutionRate).toBeCloseTo(0.8);
    });

    it('should clamp aiResolutionRate to 0 when handoffs exceed conversations', async () => {
      setupZeroMocks();
      (mockPrisma.conversation.count as jest.MockedFunction<typeof mockPrisma.conversation.count>)
        .mockResolvedValue(5 as never);
      (mockPrisma.ticket.count as jest.MockedFunction<typeof mockPrisma.ticket.count>)
        .mockResolvedValueOnce(0 as never)
        .mockResolvedValueOnce(10 as never); // more handoffs than conversations

      const result = await service.getStats();
      expect(result.aiResolutionRate).toBe(0);
    });

    // ── 7. latestAuditEvents only takes 5 ────────────────────────────────────

    it('should query auditLog with take: 5 and orderBy createdAt desc', async () => {
      setupZeroMocks();
      await service.getStats();

      const call = (mockPrisma.auditLog.findMany as jest.MockedFunction<typeof mockPrisma.auditLog.findMany>).mock.calls[0][0] as {
        take: number;
        orderBy: { createdAt: string };
      };
      expect(call.take).toBe(5);
      expect(call.orderBy.createdAt).toBe('desc');
    });

    it('should return latestAuditEvents mapped correctly', async () => {
      setupZeroMocks();
      (mockPrisma.auditLog.findMany as jest.MockedFunction<typeof mockPrisma.auditLog.findMany>)
        .mockResolvedValue([
          {
            id: 42,
            eventType: 'chat_response',
            eventData: { action: 'rag' },
            createdAt: new Date('2026-05-15T10:00:00.000Z'),
          },
          {
            id: 43,
            eventType: 'prompt_guard_blocked',
            eventData: null,
            createdAt: new Date('2026-05-15T09:00:00.000Z'),
          },
        ] as never);

      const result = await service.getStats();

      expect(result.latestAuditEvents).toHaveLength(2);
      expect(result.latestAuditEvents[0].id).toBe(42);
      expect(result.latestAuditEvents[0].eventType).toBe('chat_response');
      expect(result.latestAuditEvents[0].summary).toBe('chat_response: rag');
      expect(result.latestAuditEvents[1].summary).toBe('prompt_guard_blocked');
    });

    // ── 8. latestAuditEvents does NOT include full eventData ──────────────────

    it('should not include eventData in latestAuditEvents items', async () => {
      setupZeroMocks();
      (mockPrisma.auditLog.findMany as jest.MockedFunction<typeof mockPrisma.auditLog.findMany>)
        .mockResolvedValue([
          {
            id: 1,
            eventType: 'chat_response',
            eventData: { rawQuery: 'secret', intentLabel: 'test' },
            createdAt: new Date('2026-05-15T10:00:00.000Z'),
          },
        ] as never);

      const result = await service.getStats();

      const event = result.latestAuditEvents[0] as unknown as Record<string, unknown>;
      expect(event.eventData).toBeUndefined();
      expect(Object.keys(event)).toEqual(
        expect.arrayContaining(['id', 'eventType', 'summary', 'createdAt']),
      );
    });

    // ── 9. chart arrays always empty ──────────────────────────────────────────

    it('should always return empty arrays for chart data', async () => {
      setupZeroMocks();

      const result = await service.getStats();

      expect(result.conversationTrend).toEqual([]);
      expect(result.intentDistribution).toEqual([]);
      expect(result.handoffReasonDistribution).toEqual([]);
    });

    // ── 10. optional month override ───────────────────────────────────────────

    it('should accept a valid month override and use its boundaries', async () => {
      setupZeroMocks();
      await service.getStats('2026-01');

      const calls = (mockPrisma.conversation.count as jest.MockedFunction<typeof mockPrisma.conversation.count>).mock.calls;
      const monthlyCall = calls[1][0] as { where: { createdAt: { gte: Date } } };
      expect(monthlyCall.where.createdAt.gte).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    });

    it('should throw BadRequestException for an invalid month string', async () => {
      await expect(service.getStats('bad-format')).rejects.toThrow(BadRequestException);
      await expect(service.getStats('2026-13')).rejects.toThrow(BadRequestException);
    });
  });
});
