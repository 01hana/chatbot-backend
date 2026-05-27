import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConversationsAdminService } from './conversations-admin.service';
import { FeedbackService } from '../../feedback/feedback.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ListConversationsQueryDto } from './dto/list-conversations-query.dto';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeConvRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    sessionId: 'sess-uuid-1',
    session_token: 'token-uuid-1',
    status: 'active',
    type: 'normal',
    language: 'zh-TW',
    riskLevel: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-02T00:00:00Z'),
    deletedAt: null,
    _count: { messages: 5, feedbacks: 1 },
    messages: [{ content: 'Hello world', createdAt: new Date() }],
    ...overrides,
  };
}

function makeMessageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    conversationId: 1,
    role: 'user',
    type: 'normal',
    content: 'Test message',
    riskLevel: null,
    blockedReason: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  conversation: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
  },
  auditLog: {
    findMany: jest.fn(),
  },
};

const mockFeedbackService = {
  getConversationSummary: jest.fn(),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ConversationsAdminService', () => {
  let service: ConversationsAdminService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationsAdminService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: FeedbackService, useValue: mockFeedbackService },
      ],
    }).compile();

    service = module.get<ConversationsAdminService>(ConversationsAdminService);
    jest.clearAllMocks();
  });

  // ── 1. list — pagination ──────────────────────────────────────────────────

  describe('list()', () => {
    it('should use default pagination (page=1, pageSize=20)', async () => {
      const rows = [makeConvRow()];
      (mockPrisma.conversation.findMany as jest.MockedFunction<typeof mockPrisma.conversation.findMany>).mockResolvedValue(rows as never);
      (mockPrisma.conversation.count as jest.MockedFunction<typeof mockPrisma.conversation.count>).mockResolvedValue(1 as never);
      (mockPrisma.auditLog.findMany as jest.MockedFunction<typeof mockPrisma.auditLog.findMany>).mockResolvedValue([] as never);

      const query: ListConversationsQueryDto = {};
      const result = await service.list(query);

      expect(result.meta.page).toBe(1);
      expect(result.meta.pageSize).toBe(20);
      expect(result.meta.total).toBe(1);
      expect(result.data).toHaveLength(1);
    });

    it('should clamp pageSize to 100', async () => {
      (mockPrisma.conversation.findMany as jest.MockedFunction<typeof mockPrisma.conversation.findMany>).mockResolvedValue([] as never);
      (mockPrisma.conversation.count as jest.MockedFunction<typeof mockPrisma.conversation.count>).mockResolvedValue(0 as never);
      (mockPrisma.auditLog.findMany as jest.MockedFunction<typeof mockPrisma.auditLog.findMany>).mockResolvedValue([] as never);

      const query: ListConversationsQueryDto = { pageSize: 999 };
      const result = await service.list(query);

      expect(result.meta.pageSize).toBe(100);
      const call = (mockPrisma.conversation.findMany as jest.MockedFunction<typeof mockPrisma.conversation.findMany>).mock.calls[0][0] as { take: number };
      expect(call.take).toBe(100);
    });

    it('should apply skip based on page', async () => {
      (mockPrisma.conversation.findMany as jest.MockedFunction<typeof mockPrisma.conversation.findMany>).mockResolvedValue([] as never);
      (mockPrisma.conversation.count as jest.MockedFunction<typeof mockPrisma.conversation.count>).mockResolvedValue(0 as never);
      (mockPrisma.auditLog.findMany as jest.MockedFunction<typeof mockPrisma.auditLog.findMany>).mockResolvedValue([] as never);

      const query: ListConversationsQueryDto = { page: 3, pageSize: 10 };
      await service.list(query);

      const call = (mockPrisma.conversation.findMany as jest.MockedFunction<typeof mockPrisma.conversation.findMany>).mock.calls[0][0] as { skip: number; take: number };
      expect(call.skip).toBe(20);
      expect(call.take).toBe(10);
    });

    // ── 2. list — filters ──────────────────────────────────────────────────

    it('should filter by sessionId (case-insensitive contains)', async () => {
      (mockPrisma.conversation.findMany as jest.MockedFunction<typeof mockPrisma.conversation.findMany>).mockResolvedValue([] as never);
      (mockPrisma.conversation.count as jest.MockedFunction<typeof mockPrisma.conversation.count>).mockResolvedValue(0 as never);
      (mockPrisma.auditLog.findMany as jest.MockedFunction<typeof mockPrisma.auditLog.findMany>).mockResolvedValue([] as never);

      const query: ListConversationsQueryDto = { sessionId: 'sess-abc' };
      await service.list(query);

      const call = (mockPrisma.conversation.findMany as jest.MockedFunction<typeof mockPrisma.conversation.findMany>).mock.calls[0][0] as { where: { AND: { sessionId: unknown }[] } };
      const andClauses = call.where.AND as Record<string, unknown>[];
      const hasSessionId = andClauses.some(
        (c) =>
          (c.sessionId as Record<string, unknown>)?.contains === 'sess-abc',
      );
      expect(hasSessionId).toBe(true);
    });

    it('should filter by language', async () => {
      (mockPrisma.conversation.findMany as jest.MockedFunction<typeof mockPrisma.conversation.findMany>).mockResolvedValue([] as never);
      (mockPrisma.conversation.count as jest.MockedFunction<typeof mockPrisma.conversation.count>).mockResolvedValue(0 as never);
      (mockPrisma.auditLog.findMany as jest.MockedFunction<typeof mockPrisma.auditLog.findMany>).mockResolvedValue([] as never);

      const query: ListConversationsQueryDto = { language: 'en' };
      await service.list(query);

      const call = (mockPrisma.conversation.findMany as jest.MockedFunction<typeof mockPrisma.conversation.findMany>).mock.calls[0][0] as { where: { AND: Record<string, unknown>[] } };
      const hasLang = call.where.AND.some((c) => c.language === 'en');
      expect(hasLang).toBe(true);
    });

    it('should filter by type', async () => {
      (mockPrisma.conversation.findMany as jest.MockedFunction<typeof mockPrisma.conversation.findMany>).mockResolvedValue([] as never);
      (mockPrisma.conversation.count as jest.MockedFunction<typeof mockPrisma.conversation.count>).mockResolvedValue(0 as never);
      (mockPrisma.auditLog.findMany as jest.MockedFunction<typeof mockPrisma.auditLog.findMany>).mockResolvedValue([] as never);

      const query: ListConversationsQueryDto = { type: 'confidential' };
      await service.list(query);

      const call = (mockPrisma.conversation.findMany as jest.MockedFunction<typeof mockPrisma.conversation.findMany>).mock.calls[0][0] as { where: { AND: Record<string, unknown>[] } };
      const hasType = call.where.AND.some((c) => c.type === 'confidential');
      expect(hasType).toBe(true);
    });

    it('should filter by dateFrom and dateTo', async () => {
      (mockPrisma.conversation.findMany as jest.MockedFunction<typeof mockPrisma.conversation.findMany>).mockResolvedValue([] as never);
      (mockPrisma.conversation.count as jest.MockedFunction<typeof mockPrisma.conversation.count>).mockResolvedValue(0 as never);
      (mockPrisma.auditLog.findMany as jest.MockedFunction<typeof mockPrisma.auditLog.findMany>).mockResolvedValue([] as never);

      const query: ListConversationsQueryDto = {
        dateFrom: '2024-01-01',
        dateTo: '2024-12-31',
      };
      await service.list(query);

      const call = (mockPrisma.conversation.findMany as jest.MockedFunction<typeof mockPrisma.conversation.findMany>).mock.calls[0][0] as { where: { AND: Record<string, unknown>[] } };
      const dateClause = call.where.AND.find(
        (c) => c.createdAt !== undefined,
      ) as { createdAt: { gte: Date; lte: Date } } | undefined;
      expect(dateClause).toBeDefined();
      expect(dateClause?.createdAt?.gte).toBeInstanceOf(Date);
      expect(dateClause?.createdAt?.lte).toBeInstanceOf(Date);
    });

    it('should filter hasFeedback=true (feedbacks.some)', async () => {
      (mockPrisma.conversation.findMany as jest.MockedFunction<typeof mockPrisma.conversation.findMany>).mockResolvedValue([] as never);
      (mockPrisma.conversation.count as jest.MockedFunction<typeof mockPrisma.conversation.count>).mockResolvedValue(0 as never);
      (mockPrisma.auditLog.findMany as jest.MockedFunction<typeof mockPrisma.auditLog.findMany>).mockResolvedValue([] as never);

      const query: ListConversationsQueryDto = { hasFeedback: true };
      await service.list(query);

      const call = (mockPrisma.conversation.findMany as jest.MockedFunction<typeof mockPrisma.conversation.findMany>).mock.calls[0][0] as { where: { AND: Record<string, unknown>[] } };
      const hasFbClause = call.where.AND.find(
        (c) => c.feedbacks !== undefined,
      ) as { feedbacks: { some: Record<string, unknown> } } | undefined;
      expect(hasFbClause?.feedbacks?.some).toBeDefined();
    });

    it('should filter by intentLabel via auditLog JSON path query', async () => {
      // intentLabel pre-fetch returns one sessionId
      (mockPrisma.auditLog.findMany as jest.MockedFunction<typeof mockPrisma.auditLog.findMany>)
        .mockResolvedValueOnce([{ sessionId: 'sess-intent-1' }] as never);
      (mockPrisma.conversation.findMany as jest.MockedFunction<typeof mockPrisma.conversation.findMany>).mockResolvedValue([] as never);
      (mockPrisma.conversation.count as jest.MockedFunction<typeof mockPrisma.conversation.count>).mockResolvedValue(0 as never);

      const query: ListConversationsQueryDto = { intentLabel: 'product_inquiry' };
      await service.list(query);

      // auditLog called with JSON path filter
      const auditCall = (mockPrisma.auditLog.findMany as jest.MockedFunction<typeof mockPrisma.auditLog.findMany>).mock.calls[0][0] as {
        where: { eventData: { path: string[]; equals: string } };
      };
      expect(auditCall.where.eventData.path).toEqual(['intentLabel']);
      expect(auditCall.where.eventData.equals).toBe('product_inquiry');

      // Conversation findMany should include sessionId in filter
      const convCall = (mockPrisma.conversation.findMany as jest.MockedFunction<typeof mockPrisma.conversation.findMany>).mock.calls[0][0] as {
        where: { AND: Record<string, unknown>[] };
      };
      const intentClause = convCall.where.AND.find(
        (c) => (c.sessionId as Record<string, unknown>)?.in !== undefined,
      );
      expect(intentClause).toBeDefined();
      expect(
        (intentClause?.sessionId as Record<string, unknown>)?.in,
      ).toContain('sess-intent-1');
    });

    it('should set VM fields correctly', async () => {
      const row = makeConvRow({
        type: 'confidential',
        _count: { messages: 3, feedbacks: 0 },
        messages: [{ content: 'A'.repeat(200), createdAt: new Date() }],
      });
      (mockPrisma.conversation.findMany as jest.MockedFunction<typeof mockPrisma.conversation.findMany>).mockResolvedValue([row] as never);
      (mockPrisma.conversation.count as jest.MockedFunction<typeof mockPrisma.conversation.count>).mockResolvedValue(1 as never);
      (mockPrisma.auditLog.findMany as jest.MockedFunction<typeof mockPrisma.auditLog.findMany>).mockResolvedValue([] as never);

      const result = await service.list({});
      const vm = result.data[0];

      expect(vm.sessionToken).toBe('token-uuid-1');
      expect(vm.messageCount).toBe(3);
      expect(vm.hasFeedback).toBe(false);
      expect(vm.hasConfidential).toBe(true);
      expect(vm.lastMessagePreview).toHaveLength(120); // sliced to 120
    });
  });

  // ── export ──────────────────────────────────────────────────────

  describe('export()', () => {
    it('should use take=10000 (not capped at pageSize 100)', async () => {
      (mockPrisma.auditLog.findMany as jest.MockedFunction<typeof mockPrisma.auditLog.findMany>).mockResolvedValue([] as never);
      (mockPrisma.conversation.findMany as jest.MockedFunction<typeof mockPrisma.conversation.findMany>).mockResolvedValue([] as never);

      await service.export({});

      const call = (mockPrisma.conversation.findMany as jest.MockedFunction<typeof mockPrisma.conversation.findMany>).mock.calls[0][0] as { take: number };
      expect(call.take).toBe(10000);
    });

    it('should return a data:text/csv;base64 URL', async () => {
      const row = makeConvRow();
      (mockPrisma.auditLog.findMany as jest.MockedFunction<typeof mockPrisma.auditLog.findMany>).mockResolvedValue([] as never);
      (mockPrisma.conversation.findMany as jest.MockedFunction<typeof mockPrisma.conversation.findMany>).mockResolvedValue([row] as never);

      const result = await service.export({});

      expect(result.url).toMatch(/^data:text\/csv;base64,/);
    });
  });

  // ── 3. findOne — detail ───────────────────────────────────────────────────

  describe('findOne()', () => {
    it('should throw NotFoundException when conversation not found', async () => {
      (mockPrisma.conversation.findUnique as jest.MockedFunction<typeof mockPrisma.conversation.findUnique>).mockResolvedValue(null as never);

      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
    });

    it('should return detail with messages, auditEvents and feedbackSummary', async () => {
      const conv = {
        id: 1,
        sessionId: 'sess-uuid-1',
        session_token: 'token-uuid-1',
        status: 'active',
        type: 'normal',
        language: 'zh-TW',
        riskLevel: null,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-02T00:00:00Z'),
        _count: { messages: 1 },
        messages: [makeMessageRow()],
      };
      const auditEvent = {
        id: 100,
        eventType: 'chat_response',
        eventData: { answer: 'test' },
        sessionId: 'sess-uuid-1',
        createdAt: new Date('2024-01-01T00:05:00Z'),
      };
      const feedbackSummary = {
        totalCount: 1,
        upCount: 1,
        downCount: 0,
        reasons: [],
      };

      (mockPrisma.conversation.findUnique as jest.MockedFunction<typeof mockPrisma.conversation.findUnique>).mockResolvedValue(conv as never);
      (mockPrisma.auditLog.findMany as jest.MockedFunction<typeof mockPrisma.auditLog.findMany>).mockResolvedValue([auditEvent] as never);
      (mockFeedbackService.getConversationSummary as jest.MockedFunction<typeof mockFeedbackService.getConversationSummary>).mockResolvedValue(feedbackSummary as never);

      const result = await service.findOne(1);

      expect(result.id).toBe(1);
      expect(result.sessionToken).toBe('token-uuid-1');
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].content).toBe('Test message');
      expect(result.auditEvents).toHaveLength(1);
      expect(result.auditEvents[0].eventType).toBe('chat_response');
      expect(result.feedbackSummary.totalCount).toBe(1);
    });

    it('should return auditEvents with summarized eventData (strips internal fields)', async () => {
      const conv = {
        id: 1,
        sessionId: 'sess-uuid-1',
        session_token: 'token-uuid-1',
        status: 'active',
        type: 'normal',
        language: 'zh-TW',
        riskLevel: null,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-02T00:00:00Z'),
        _count: { messages: 0 },
        messages: [],
      };
      const auditEvent = {
        id: 200,
        eventType: 'chat_response',
        sessionId: 'sess-uuid-1',
        createdAt: new Date('2024-01-01T00:05:00Z'),
        eventData: {
          intentLabel: 'product_inquiry',
          action: 'answer',
          rawQuery: 'this should be stripped',
          fullKnowledge: 'huge knowledge content',
        },
      };

      (mockPrisma.conversation.findUnique as jest.MockedFunction<typeof mockPrisma.conversation.findUnique>).mockResolvedValue(conv as never);
      (mockPrisma.auditLog.findMany as jest.MockedFunction<typeof mockPrisma.auditLog.findMany>).mockResolvedValue([auditEvent] as never);
      (mockFeedbackService.getConversationSummary as jest.MockedFunction<typeof mockFeedbackService.getConversationSummary>).mockResolvedValue({ totalCount: 0, upCount: 0, downCount: 0, reasons: [] } as never);

      const result = await service.findOne(1);
      const eventData = result.auditEvents[0].eventData as Record<string, unknown>;

      // Summary fields preserved
      expect(eventData.intentLabel).toBe('product_inquiry');
      expect(eventData.action).toBe('answer');
      // Internal/heavy fields stripped
      expect(eventData.rawQuery).toBeUndefined();
      expect(eventData.fullKnowledge).toBeUndefined();
    });
  });
});
