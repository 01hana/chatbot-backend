import { describe, beforeEach, it, expect, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { DiagnosisService } from './diagnosis.service';
import { ConversationService } from '../conversation/conversation.service';
import type { DiagnosisContext, DiagnosisQuestion } from './types/diagnosis-context.type';

// ─── Factories ────────────────────────────────────────────────────────────────

function makeQuestion(overrides: Partial<DiagnosisQuestion> = {}): DiagnosisQuestion {
  return {
    fieldKey: 'material_preference',
    questionZh: '您偏好哪種材質？',
    questionEn: 'Which material do you prefer?',
    required: true,
    ...overrides,
  };
}

function makeContext(overrides: Partial<DiagnosisContext> = {}): DiagnosisContext {
  return {
    flowId: 'product-diagnosis-v1',
    currentStep: 0,
    pendingQuestions: [makeQuestion()],
    collectedAnswers: {},
    isComplete: false,
    ...overrides,
  };
}

// ─── Mock ConversationService ─────────────────────────────────────────────────

function makeMockConversationService(): jest.Mocked<
  Pick<ConversationService, 'getDiagnosisContext' | 'updateDiagnosisContext'>
> {
  return {
    getDiagnosisContext: jest.fn(),
    updateDiagnosisContext: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DiagnosisService', () => {
  let service: DiagnosisService;
  let mockConvService: ReturnType<typeof makeMockConversationService>;

  beforeEach(() => {
    mockConvService = makeMockConversationService();
    service = new DiagnosisService(
      mockConvService as unknown as ConversationService,
    );
  });

  // ── initFlow ──────────────────────────────────────────────────────────────

  it('initFlow: writes a fresh DiagnosisContext with all supplied questions', async () => {
    const questions = [
      makeQuestion({ fieldKey: 'material_preference' }),
      makeQuestion({ fieldKey: 'size_range', questionZh: '尺寸範圍？', questionEn: 'Size range?' }),
    ];

    await service.initFlow(1, 'product-diagnosis-v1', questions);

    expect(mockConvService.updateDiagnosisContext).toHaveBeenCalledTimes(1);
    const [calledId, ctx] = (mockConvService.updateDiagnosisContext as jest.Mock).mock.calls[0] as [
      number,
      DiagnosisContext,
    ];
    expect(calledId).toBe(1);
    expect(ctx.flowId).toBe('product-diagnosis-v1');
    expect(ctx.currentStep).toBe(0);
    expect(ctx.pendingQuestions).toHaveLength(2);
    expect(ctx.collectedAnswers).toEqual({});
    expect(ctx.isComplete).toBe(false);
  });

  it('initFlow: marks isComplete=true when the question list is empty', async () => {
    await service.initFlow(1, 'empty-flow', []);

    const [, ctx] = (mockConvService.updateDiagnosisContext as jest.Mock).mock.calls[0] as [
      number,
      DiagnosisContext,
    ];
    expect(ctx.isComplete).toBe(true);
    expect(ctx.pendingQuestions).toHaveLength(0);
  });

  // ── getNextQuestion ───────────────────────────────────────────────────────

  it('getNextQuestion: returns the first pending question', async () => {
    const q1 = makeQuestion({ fieldKey: 'material_preference' });
    const q2 = makeQuestion({ fieldKey: 'size_range' });
    mockConvService.getDiagnosisContext.mockResolvedValue(
      makeContext({ pendingQuestions: [q1, q2] }),
    );

    const result = await service.getNextQuestion(1, 'zh-TW');

    expect(result).not.toBeNull();
    expect(result!.fieldKey).toBe('material_preference');
  });

  it('getNextQuestion: returns null when flow has not been initialised', async () => {
    mockConvService.getDiagnosisContext.mockResolvedValue(null);

    const result = await service.getNextQuestion(99, 'zh-TW');

    expect(result).toBeNull();
  });

  it('getNextQuestion: returns null when isComplete=true', async () => {
    mockConvService.getDiagnosisContext.mockResolvedValue(
      makeContext({ isComplete: true, pendingQuestions: [] }),
    );

    const result = await service.getNextQuestion(1, 'zh-TW');

    expect(result).toBeNull();
  });

  it('getNextQuestion: returns null when pendingQuestions is empty', async () => {
    mockConvService.getDiagnosisContext.mockResolvedValue(
      makeContext({ pendingQuestions: [], isComplete: false }),
    );

    const result = await service.getNextQuestion(1, 'en');

    expect(result).toBeNull();
  });

  // ── recordAnswer ──────────────────────────────────────────────────────────

  it('recordAnswer: stores the answer and shifts the pending question', async () => {
    const q1 = makeQuestion({ fieldKey: 'material_preference' });
    const q2 = makeQuestion({ fieldKey: 'size_range' });
    mockConvService.getDiagnosisContext.mockResolvedValue(
      makeContext({ pendingQuestions: [q1, q2], collectedAnswers: {} }),
    );

    await service.recordAnswer(1, 'material_preference', '不鏽鋼 SUS304');

    const [, updatedCtx] = (
      mockConvService.updateDiagnosisContext as jest.Mock
    ).mock.calls[0] as [number, DiagnosisContext];

    expect(updatedCtx.collectedAnswers).toEqual({ material_preference: '不鏽鋼 SUS304' });
    expect(updatedCtx.pendingQuestions.map((q) => q.fieldKey)).toEqual(['size_range']);
    expect(updatedCtx.currentStep).toBe(1);
    expect(updatedCtx.isComplete).toBe(false);
  });

  it('recordAnswer: sets isComplete=true when last question is answered', async () => {
    const q = makeQuestion({ fieldKey: 'size_range' });
    mockConvService.getDiagnosisContext.mockResolvedValue(
      makeContext({ pendingQuestions: [q], collectedAnswers: { material_preference: '不鏽鋼' } }),
    );

    await service.recordAnswer(1, 'size_range', 'M3~M8');

    const [, updatedCtx] = (
      mockConvService.updateDiagnosisContext as jest.Mock
    ).mock.calls[0] as [number, DiagnosisContext];

    expect(updatedCtx.isComplete).toBe(true);
    expect(updatedCtx.pendingQuestions).toHaveLength(0);
    expect(updatedCtx.collectedAnswers).toEqual({
      material_preference: '不鏽鋼',
      size_range: 'M3~M8',
    });
  });

  it('recordAnswer: throws NotFoundException when no diagnosis flow exists', async () => {
    mockConvService.getDiagnosisContext.mockResolvedValue(null);

    await expect(service.recordAnswer(99, 'size_range', 'M3')).rejects.toThrow(
      NotFoundException,
    );
  });

  // ── isComplete ────────────────────────────────────────────────────────────

  it('isComplete: returns true when context.isComplete is true', async () => {
    mockConvService.getDiagnosisContext.mockResolvedValue(
      makeContext({ isComplete: true, pendingQuestions: [] }),
    );

    expect(await service.isComplete(1)).toBe(true);
  });

  it('isComplete: returns false when flow is not initialised', async () => {
    mockConvService.getDiagnosisContext.mockResolvedValue(null);

    expect(await service.isComplete(99)).toBe(false);
  });

  // ── getCollectedAnswers ───────────────────────────────────────────────────

  it('getCollectedAnswers: returns accumulated answers after multiple recordAnswer calls', async () => {
    mockConvService.getDiagnosisContext.mockResolvedValue(
      makeContext({
        collectedAnswers: { material_preference: '不鏽鋼', size_range: 'M3~M8' },
      }),
    );

    const answers = await service.getCollectedAnswers(1);

    expect(answers).toEqual({ material_preference: '不鏽鋼', size_range: 'M3~M8' });
  });

  it('getCollectedAnswers: returns empty object when flow is not initialised', async () => {
    mockConvService.getDiagnosisContext.mockResolvedValue(null);

    const answers = await service.getCollectedAnswers(99);

    expect(answers).toEqual({});
  });
});
