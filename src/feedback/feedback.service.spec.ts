import { describe, beforeEach, it, expect, jest } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import {
  FeedbackRepository,
  ConversationFeedbackSummary,
  DashboardFeedbackSummary,
} from './feedback.repository';
import type { Conversation, ConversationMessage, Feedback } from '../generated/prisma/client';

// ─── Factories ───────────────────────────────────────────────────────────────

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 1,
    sessionId: 'sess-uuid-001',
    session_token: 'token-abc',
    status: 'active',
    type: 'normal',
    riskLevel: null,
    sensitiveIntentCount: 0,
    highIntentScore: 0,
    diagnosisContext: null,
    language: 'zh-TW',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    id: 42,
    conversationId: 1,
    role: 'assistant',
    content: 'This is an answer.',
    type: 'normal',
    riskLevel: null,
    blockedReason: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeFeedback(overrides: Partial<Feedback> = {}): Feedback {
  return {
    id: 100,
    conversationId: 1,
    messageId: 42,
    value: 'up',
    reason: null,
    createdAt: new Date(),
    ...overrides,
  };
}

// ─── Mock ─────────────────────────────────────────────────────────────────────

type MockRepo = {
  [K in keyof FeedbackRepository]: jest.MockedFunction<FeedbackRepository[K]>;
};

function makeRepo(): MockRepo {
  return {
    findConversationByToken: jest.fn(),
    findMessageById: jest.fn(),
    createFeedback: jest.fn(),
    deleteByMessageId: jest.fn(),
    findByMessageId: jest.fn(),
    list: jest.fn(),
    summaryByConversation: jest.fn(),
    dashboardSummary: jest.fn(),
    countByValue: jest.fn(),
  } as unknown as MockRepo;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('FeedbackService', () => {
  let service: FeedbackService;
  let repo: MockRepo;

  beforeEach(() => {
    repo = makeRepo();
    service = new FeedbackService(repo as unknown as FeedbackRepository);
  });

  afterEach(() => { jest.clearAllMocks(); });

  // ── submitFeedback ────────────────────────────────────────────────────────

  describe('submitFeedback()', () => {
    it('submits up feedback successfully', async () => {
      repo.findConversationByToken.mockResolvedValue(makeConversation());
      repo.findMessageById.mockResolvedValue(makeMessage());
      repo.deleteByMessageId.mockResolvedValue(undefined);
      repo.createFeedback.mockResolvedValue(makeFeedback({ value: 'up' }));

      const result = await service.submitFeedback('token-abc', 42, { value: 'up' });

      expect(result.value).toBe('up');
      expect(repo.deleteByMessageId).toHaveBeenCalledWith(42);
      expect(repo.createFeedback).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId: 1, messageId: 42, value: 'up' }),
      );
    });

    it('submits down feedback with reason successfully', async () => {
      repo.findConversationByToken.mockResolvedValue(makeConversation());
      repo.findMessageById.mockResolvedValue(makeMessage());
      repo.deleteByMessageId.mockResolvedValue(undefined);
      repo.createFeedback.mockResolvedValue(makeFeedback({ value: 'down', reason: 'Wrong answer' }));

      const result = await service.submitFeedback('token-abc', 42, {
        value: 'down',
        reason: 'Wrong answer',
      });

      expect(result.value).toBe('down');
      expect(result.reason).toBe('Wrong answer');
      expect(repo.createFeedback).toHaveBeenCalledWith(
        expect.objectContaining({ value: 'down', reason: 'Wrong answer' }),
      );
    });

    it('throws BadRequestException for invalid value', async () => {
      await expect(
        service.submitFeedback('token-abc', 42, { value: 'invalid' }),
      ).rejects.toThrow(BadRequestException);

      expect(repo.findConversationByToken).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when sessionToken not found', async () => {
      repo.findConversationByToken.mockResolvedValue(null);

      await expect(
        service.submitFeedback('unknown-token', 42, { value: 'up' }),
      ).rejects.toThrow(NotFoundException);

      expect(repo.findMessageById).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when messageId not found', async () => {
      repo.findConversationByToken.mockResolvedValue(makeConversation());
      repo.findMessageById.mockResolvedValue(null);

      await expect(
        service.submitFeedback('token-abc', 999, { value: 'up' }),
      ).rejects.toThrow(NotFoundException);

      expect(repo.deleteByMessageId).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when message does not belong to session', async () => {
      repo.findConversationByToken.mockResolvedValue(makeConversation({ id: 1 }));
      // Message belongs to a different conversation
      repo.findMessageById.mockResolvedValue(makeMessage({ conversationId: 99 }));

      await expect(
        service.submitFeedback('token-abc', 42, { value: 'up' }),
      ).rejects.toThrow(BadRequestException);

      expect(repo.deleteByMessageId).not.toHaveBeenCalled();
    });

    it('replaces previous feedback for the same message (upsert strategy)', async () => {
      repo.findConversationByToken.mockResolvedValue(makeConversation());
      repo.findMessageById.mockResolvedValue(makeMessage());
      repo.deleteByMessageId.mockResolvedValue(undefined);
      repo.createFeedback.mockResolvedValue(makeFeedback({ value: 'down' }));

      await service.submitFeedback('token-abc', 42, { value: 'down' });

      // deleteByMessageId must always be called before createFeedback
      expect(repo.deleteByMessageId).toHaveBeenCalledWith(42);
      expect(repo.createFeedback).toHaveBeenCalledTimes(1);
    });

    it('throws BadRequestException when message role is not assistant', async () => {
      repo.findConversationByToken.mockResolvedValue(makeConversation());
      // user message — not allowed
      repo.findMessageById.mockResolvedValue(makeMessage({ role: 'user' }));

      await expect(
        service.submitFeedback('token-abc', 42, { value: 'up' }),
      ).rejects.toThrow(BadRequestException);

      expect(repo.deleteByMessageId).not.toHaveBeenCalled();
      expect(repo.createFeedback).not.toHaveBeenCalled();
    });

    it('stores null reason when reason is omitted', async () => {
      repo.findConversationByToken.mockResolvedValue(makeConversation());
      repo.findMessageById.mockResolvedValue(makeMessage());
      repo.deleteByMessageId.mockResolvedValue(undefined);
      repo.createFeedback.mockResolvedValue(makeFeedback());

      await service.submitFeedback('token-abc', 42, { value: 'up' });

      expect(repo.createFeedback).toHaveBeenCalledWith(
        expect.objectContaining({ reason: null }),
      );
    });
  });

  // ── getConversationSummary ────────────────────────────────────────────────

  describe('getConversationSummary()', () => {
    it('returns summary with correct counts', async () => {
      const summary: ConversationFeedbackSummary = {
        totalCount: 5,
        upCount: 4,
        downCount: 1,
        reasons: [{ label: 'Inaccurate', count: 1 }],
      };
      repo.summaryByConversation.mockResolvedValue(summary);

      const result = await service.getConversationSummary(1);

      expect(result.totalCount).toBe(5);
      expect(result.upCount).toBe(4);
      expect(result.downCount).toBe(1);
      expect(result.reasons).toHaveLength(1);
      expect(result.reasons[0].label).toBe('Inaccurate');
      expect(repo.summaryByConversation).toHaveBeenCalledWith(1);
    });

    it('returns empty reasons array when no reason feedback exists', async () => {
      repo.summaryByConversation.mockResolvedValue({
        totalCount: 3,
        upCount: 3,
        downCount: 0,
        reasons: [],
      });

      const result = await service.getConversationSummary(2);
      expect(result.reasons).toEqual([]);
    });
  });

  // ── getDashboardSummary ───────────────────────────────────────────────────

  describe('getDashboardSummary()', () => {
    it('returns dashboard summary with upRate', async () => {
      const summary: DashboardFeedbackSummary = {
        totalCount: 10,
        upCount: 8,
        downCount: 2,
        upRate: 0.8,
      };
      repo.dashboardSummary.mockResolvedValue(summary);

      const result = await service.getDashboardSummary();

      expect(result).toEqual({ totalCount: 10, upCount: 8, downCount: 2, upRate: 0.8 });
    });

    it('returns upRate=0 when totalCount is 0', async () => {
      repo.dashboardSummary.mockResolvedValue({
        totalCount: 0, upCount: 0, downCount: 0, upRate: 0,
      });

      const result = await service.getDashboardSummary();
      expect(result.upRate).toBe(0);
    });

    it('passes dateRange to repository', async () => {
      repo.dashboardSummary.mockResolvedValue({
        totalCount: 1, upCount: 1, downCount: 0, upRate: 1,
      });

      const dateRange = { from: new Date('2026-01-01'), to: new Date('2026-01-31') };
      await service.getDashboardSummary(dateRange);

      expect(repo.dashboardSummary).toHaveBeenCalledWith(dateRange);
    });
  });

  // ── list ──────────────────────────────────────────────────────────────────

  describe('list()', () => {
    it('returns items and total', async () => {
      repo.list.mockResolvedValue({ items: [makeFeedback()], total: 1 });

      const result = await service.list({ conversationId: 1 });
      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
    });
  });
});
