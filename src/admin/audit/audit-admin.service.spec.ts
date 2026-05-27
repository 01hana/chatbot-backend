import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditAdminService } from './audit-admin.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAuditRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    requestId: 'req-abc-123',
    sessionId: 'sess-uuid-1',
    eventType: 'chat_response',
    eventData: { answer: 'Hello' },
    knowledgeRefs: ['k1', 'k2'],
    ragConfidence: 0.85,
    blockedReason: null,
    promptHash: null,
    promptTokens: 120,
    completionTokens: 80,
    totalTokens: 200,
    durationMs: 350,
    aiModel: 'gpt-5.4-mini',
    aiProvider: 'openai',
    configSnapshot: {},
    createdAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  auditLog: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
  },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AuditAdminService', () => {
  let service: AuditAdminService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditAdminService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AuditAdminService>(AuditAdminService);
    jest.clearAllMocks();
  });

  // ── 4. list — requestId exact match ───────────────────────────────────────

  describe('list()', () => {
    it('should filter by requestId using exact match', async () => {
      (mockPrisma.auditLog.findMany as jest.MockedFunction<typeof mockPrisma.auditLog.findMany>).mockResolvedValue([makeAuditRow()] as never);
      (mockPrisma.auditLog.count as jest.MockedFunction<typeof mockPrisma.auditLog.count>).mockResolvedValue(1 as never);

      const query: ListAuditLogsQueryDto = { requestId: 'req-abc-123' };
      await service.list(query);

      const call = (mockPrisma.auditLog.findMany as jest.MockedFunction<typeof mockPrisma.auditLog.findMany>).mock.calls[0][0] as { where: Record<string, unknown> };
      // requestId should be exact string, NOT a contains object
      expect(call.where.requestId).toBe('req-abc-123');
    });

    // ── 5. list — eventType + date range filter ──────────────────────────────

    it('should filter by eventType (case-insensitive contains)', async () => {
      (mockPrisma.auditLog.findMany as jest.MockedFunction<typeof mockPrisma.auditLog.findMany>).mockResolvedValue([] as never);
      (mockPrisma.auditLog.count as jest.MockedFunction<typeof mockPrisma.auditLog.count>).mockResolvedValue(0 as never);

      const query: ListAuditLogsQueryDto = { eventType: 'chat' };
      await service.list(query);

      const call = (mockPrisma.auditLog.findMany as jest.MockedFunction<typeof mockPrisma.auditLog.findMany>).mock.calls[0][0] as { where: Record<string, unknown> };
      expect((call.where.eventType as Record<string, unknown>)?.contains).toBe('chat');
    });

    it('should filter by date range', async () => {
      (mockPrisma.auditLog.findMany as jest.MockedFunction<typeof mockPrisma.auditLog.findMany>).mockResolvedValue([] as never);
      (mockPrisma.auditLog.count as jest.MockedFunction<typeof mockPrisma.auditLog.count>).mockResolvedValue(0 as never);

      const query: ListAuditLogsQueryDto = {
        dateFrom: '2024-01-01',
        dateTo: '2024-12-31',
      };
      await service.list(query);

      const call = (mockPrisma.auditLog.findMany as jest.MockedFunction<typeof mockPrisma.auditLog.findMany>).mock.calls[0][0] as { where: Record<string, unknown> };
      expect((call.where.createdAt as Record<string, unknown>)?.gte).toBeInstanceOf(Date);
      expect((call.where.createdAt as Record<string, unknown>)?.lte).toBeInstanceOf(Date);
    });

    // ── 6. list — token fields ───────────────────────────────────────────────

    it('should include all token fields in VM', async () => {
      const row = makeAuditRow({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        durationMs: 200,
      });
      (mockPrisma.auditLog.findMany as jest.MockedFunction<typeof mockPrisma.auditLog.findMany>).mockResolvedValue([row] as never);
      (mockPrisma.auditLog.count as jest.MockedFunction<typeof mockPrisma.auditLog.count>).mockResolvedValue(1 as never);

      const result = await service.list({});
      const vm = result.data[0];

      expect(vm.promptTokens).toBe(100);
      expect(vm.completionTokens).toBe(50);
      expect(vm.totalTokens).toBe(150);
      expect(vm.durationMs).toBe(200);
    });

    it('should include aiModel and aiProvider fields', async () => {
      const row = makeAuditRow({ aiModel: 'gpt-4', aiProvider: 'openai' });
      (mockPrisma.auditLog.findMany as jest.MockedFunction<typeof mockPrisma.auditLog.findMany>).mockResolvedValue([row] as never);
      (mockPrisma.auditLog.count as jest.MockedFunction<typeof mockPrisma.auditLog.count>).mockResolvedValue(1 as never);

      const result = await service.list({});
      const vm = result.data[0];

      expect(vm.aiModel).toBe('gpt-4');
      expect(vm.aiProvider).toBe('openai');
    });

    it('should apply correct pagination', async () => {
      (mockPrisma.auditLog.findMany as jest.MockedFunction<typeof mockPrisma.auditLog.findMany>).mockResolvedValue([] as never);
      (mockPrisma.auditLog.count as jest.MockedFunction<typeof mockPrisma.auditLog.count>).mockResolvedValue(0 as never);

      const query: ListAuditLogsQueryDto = { page: 2, pageSize: 15 };
      const result = await service.list(query);

      expect(result.meta.page).toBe(2);
      expect(result.meta.pageSize).toBe(15);
      const call = (mockPrisma.auditLog.findMany as jest.MockedFunction<typeof mockPrisma.auditLog.findMany>).mock.calls[0][0] as { skip: number; take: number };
      expect(call.skip).toBe(15);
      expect(call.take).toBe(15);
    });

    it('should return summarized eventData in list (strips internal fields)', async () => {
      const row = makeAuditRow({
        eventData: {
          intentLabel: 'product_inquiry',
          action: 'answer',
          rawQuery: 'this should be stripped',
          fullKnowledge: 'huge content',
        },
      });
      (mockPrisma.auditLog.findMany as jest.MockedFunction<typeof mockPrisma.auditLog.findMany>).mockResolvedValue([row] as never);
      (mockPrisma.auditLog.count as jest.MockedFunction<typeof mockPrisma.auditLog.count>).mockResolvedValue(1 as never);

      const result = await service.list({});
      const eventData = result.data[0].eventData as Record<string, unknown>;

      // Summary fields preserved
      expect(eventData.intentLabel).toBe('product_inquiry');
      expect(eventData.action).toBe('answer');
      // Internal fields stripped
      expect(eventData.rawQuery).toBeUndefined();
      expect(eventData.fullKnowledge).toBeUndefined();
    });
  });

  // ── findOne ───────────────────────────────────────────────────────────────

  describe('findOne()', () => {
    it('should throw NotFoundException when not found', async () => {
      (mockPrisma.auditLog.findUnique as jest.MockedFunction<typeof mockPrisma.auditLog.findUnique>).mockResolvedValue(null as never);
      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
    });

    it('should return full audit detail including promptHash and configSnapshot', async () => {
      const row = makeAuditRow({ promptHash: 'abc123', configSnapshot: { key: 1 } });
      (mockPrisma.auditLog.findUnique as jest.MockedFunction<typeof mockPrisma.auditLog.findUnique>).mockResolvedValue(row as never);

      const result = await service.findOne(1);
      expect(result.promptHash).toBe('abc123');
      expect(result.configSnapshot).toEqual({ key: 1 });
    });

    it('should return full (un-summarized) eventData in detail response', async () => {
      const row = makeAuditRow({
        eventData: {
          intentLabel: 'product_inquiry',
          rawQuery: 'full query here',
          action: 'answer',
        },
      });
      (mockPrisma.auditLog.findUnique as jest.MockedFunction<typeof mockPrisma.auditLog.findUnique>).mockResolvedValue(row as never);

      const result = await service.findOne(1);
      const eventData = result.eventData as Record<string, unknown>;

      // Full data preserved in detail — rawQuery must NOT be stripped
      expect(eventData.intentLabel).toBe('product_inquiry');
      expect(eventData.rawQuery).toBe('full query here');
      expect(eventData.action).toBe('answer');
    });
  });
});
