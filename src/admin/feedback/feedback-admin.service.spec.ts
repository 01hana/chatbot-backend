import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { FeedbackAdminService } from './feedback-admin.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ListFeedbackQueryDto } from './dto/list-feedback-query.dto';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFeedbackRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    conversationId: 10,
    messageId: 100,
    value: 'up',
    reason: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    conversation: { session_token: 'tok-abc' },
    message: { content: 'What is your return policy?' },
    ...overrides,
  };
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  feedback: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('FeedbackAdminService', () => {
  let service: FeedbackAdminService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedbackAdminService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<FeedbackAdminService>(FeedbackAdminService);
    jest.clearAllMocks();
  });

  // ── 7. list — pagination ──────────────────────────────────────────────────

  describe('list()', () => {
    it('should use default pagination and return meta', async () => {
      const rows = [makeFeedbackRow()];
      (mockPrisma.feedback.findMany as jest.MockedFunction<typeof mockPrisma.feedback.findMany>).mockResolvedValue(rows as never);
      (mockPrisma.feedback.count as jest.MockedFunction<typeof mockPrisma.feedback.count>).mockResolvedValue(1 as never);

      const result = await service.list({});
      expect(result.meta.page).toBe(1);
      expect(result.meta.pageSize).toBe(20);
      expect(result.meta.total).toBe(1);
      expect(result.data).toHaveLength(1);
    });

    it('should clamp pageSize to 100', async () => {
      (mockPrisma.feedback.findMany as jest.MockedFunction<typeof mockPrisma.feedback.findMany>).mockResolvedValue([] as never);
      (mockPrisma.feedback.count as jest.MockedFunction<typeof mockPrisma.feedback.count>).mockResolvedValue(0 as never);

      const query: ListFeedbackQueryDto = { pageSize: 500 };
      const result = await service.list(query);
      expect(result.meta.pageSize).toBe(100);
    });

    it('should apply correct skip for page 3', async () => {
      (mockPrisma.feedback.findMany as jest.MockedFunction<typeof mockPrisma.feedback.findMany>).mockResolvedValue([] as never);
      (mockPrisma.feedback.count as jest.MockedFunction<typeof mockPrisma.feedback.count>).mockResolvedValue(0 as never);

      const query: ListFeedbackQueryDto = { page: 3, pageSize: 10 };
      await service.list(query);

      const call = (mockPrisma.feedback.findMany as jest.MockedFunction<typeof mockPrisma.feedback.findMany>).mock.calls[0][0] as { skip: number; take: number };
      expect(call.skip).toBe(20);
      expect(call.take).toBe(10);
    });

    // ── 8. list — value filter ────────────────────────────────────────────────

    it('should filter by value=up', async () => {
      (mockPrisma.feedback.findMany as jest.MockedFunction<typeof mockPrisma.feedback.findMany>).mockResolvedValue([makeFeedbackRow()] as never);
      (mockPrisma.feedback.count as jest.MockedFunction<typeof mockPrisma.feedback.count>).mockResolvedValue(1 as never);

      const query: ListFeedbackQueryDto = { value: 'up' };
      await service.list(query);

      const call = (mockPrisma.feedback.findMany as jest.MockedFunction<typeof mockPrisma.feedback.findMany>).mock.calls[0][0] as { where: Record<string, unknown> };
      expect(call.where.value).toBe('up');
    });

    it('should filter by value=down', async () => {
      (mockPrisma.feedback.findMany as jest.MockedFunction<typeof mockPrisma.feedback.findMany>).mockResolvedValue([] as never);
      (mockPrisma.feedback.count as jest.MockedFunction<typeof mockPrisma.feedback.count>).mockResolvedValue(0 as never);

      const query: ListFeedbackQueryDto = { value: 'down' };
      await service.list(query);

      const call = (mockPrisma.feedback.findMany as jest.MockedFunction<typeof mockPrisma.feedback.findMany>).mock.calls[0][0] as { where: Record<string, unknown> };
      expect(call.where.value).toBe('down');
    });

    it('should filter by conversationId', async () => {
      (mockPrisma.feedback.findMany as jest.MockedFunction<typeof mockPrisma.feedback.findMany>).mockResolvedValue([] as never);
      (mockPrisma.feedback.count as jest.MockedFunction<typeof mockPrisma.feedback.count>).mockResolvedValue(0 as never);

      const query: ListFeedbackQueryDto = { conversationId: 42 };
      await service.list(query);

      const call = (mockPrisma.feedback.findMany as jest.MockedFunction<typeof mockPrisma.feedback.findMany>).mock.calls[0][0] as { where: Record<string, unknown> };
      expect(call.where.conversationId).toBe(42);
    });

    // ── 9. VM — no rating field ───────────────────────────────────────────────

    it('should map VM correctly with sessionToken and messagePreview', async () => {
      const rows = [makeFeedbackRow()];
      (mockPrisma.feedback.findMany as jest.MockedFunction<typeof mockPrisma.feedback.findMany>).mockResolvedValue(rows as never);
      (mockPrisma.feedback.count as jest.MockedFunction<typeof mockPrisma.feedback.count>).mockResolvedValue(1 as never);

      const result = await service.list({});
      const vm = result.data[0];

      expect(vm.sessionToken).toBe('tok-abc');
      expect(vm.messagePreview).toBe('What is your return policy?');
      expect(vm.value).toBe('up');
      expect(vm).not.toHaveProperty('rating'); // no numeric rating
    });

    it('should not have rating property — value is up|down only', async () => {
      const rows = [makeFeedbackRow({ value: 'down', reason: 'Not helpful' })];
      (mockPrisma.feedback.findMany as jest.MockedFunction<typeof mockPrisma.feedback.findMany>).mockResolvedValue(rows as never);
      (mockPrisma.feedback.count as jest.MockedFunction<typeof mockPrisma.feedback.count>).mockResolvedValue(1 as never);

      const result = await service.list({});
      const vm = result.data[0];

      expect(vm.value).toBe('down');
      expect(vm.reason).toBe('Not helpful');
      expect(vm).not.toHaveProperty('rating');
    });

    it('should slice messagePreview to 120 chars', async () => {
      const longContent = 'A'.repeat(200);
      const rows = [makeFeedbackRow({ message: { content: longContent } })];
      (mockPrisma.feedback.findMany as jest.MockedFunction<typeof mockPrisma.feedback.findMany>).mockResolvedValue(rows as never);
      (mockPrisma.feedback.count as jest.MockedFunction<typeof mockPrisma.feedback.count>).mockResolvedValue(1 as never);

      const result = await service.list({});
      expect(result.data[0].messagePreview).toHaveLength(120);
    });
  });
});
