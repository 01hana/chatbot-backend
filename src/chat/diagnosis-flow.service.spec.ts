import { Test } from '@nestjs/testing';
import type { Conversation } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { ConversationService } from '../conversation/conversation.service';
import { DiagnosisFlowService } from './diagnosis-flow.service';
import { DiagnosisRecommendationService } from './diagnosis-recommendation.service';
import { DiagnosisService } from './diagnosis.service';
import { LeadPromptEnricherService } from './lead-prompt-enricher.service';
import type { DiagnosisContext } from './types/diagnosis-context.type';

describe('DiagnosisFlowService', () => {
  let service: DiagnosisFlowService;

  const makeConversation = (diagnosisContext: DiagnosisContext | null): Conversation =>
    ({
      id: 1,
      sessionId: 'session-1',
      session_token: 'token-1',
      status: 'active',
      type: 'standard',
      riskLevel: null,
      sensitiveIntentCount: 0,
      highIntentScore: 0,
      diagnosisContext: diagnosisContext as unknown as Conversation['diagnosisContext'],
      language: 'zh-TW',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    }) as Conversation;

  const collectingContext: DiagnosisContext = {
    stage: 'collecting',
    collectedFields: {},
    requiredFields: ['purpose', 'material', 'length', 'environment'],
    currentField: 'purpose',
  };

  const completeContext: DiagnosisContext = {
    stage: 'complete',
    collectedFields: {
      purpose: '照明',
      material: '鋁',
      length: '2m',
      environment: '室外',
    },
    requiredFields: ['purpose', 'material', 'length', 'environment'],
    currentField: null,
  };

  const recommendedContext: DiagnosisContext = {
    stage: 'recommended',
    collectedFields: {
      purpose: '照明',
      material: '鋁',
      length: '2m',
      environment: '室外',
    },
    requiredFields: ['purpose', 'material', 'length', 'environment'],
    currentField: null,
  };

  const mockDiagnosisService = {
    startOrContinue: jest.fn(),
    processAnswer: jest.fn(),
    getNextQuestion: jest.fn(),
  };

  const mockDiagnosisRecommendationService = {
    recommend: jest.fn(),
  };

  const mockLeadPromptEnricher = {
    enrich: jest.fn(),
  };

  const mockConversationService = {
    updateConversation: jest.fn(),
    addMessage: jest.fn(),
  };

  const mockAuditService = {
    log: jest.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        DiagnosisFlowService,
        { provide: DiagnosisService, useValue: mockDiagnosisService },
        { provide: DiagnosisRecommendationService, useValue: mockDiagnosisRecommendationService },
        { provide: LeadPromptEnricherService, useValue: mockLeadPromptEnricher },
        { provide: ConversationService, useValue: mockConversationService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get(DiagnosisFlowService);

    jest.clearAllMocks();

    mockDiagnosisService.startOrContinue.mockImplementation((context: DiagnosisContext | null) => {
      if (context) return context;
      return collectingContext;
    });
    mockDiagnosisService.processAnswer.mockImplementation((context: DiagnosisContext) => context);
    mockDiagnosisService.getNextQuestion.mockReturnValue('請問您的使用用途是什麼？');

    mockDiagnosisRecommendationService.recommend.mockResolvedValue({
      reply: '建議使用戶外防水線材。',
      matchedKnowledgeIds: [101],
      sourceReferences: [{ knowledgeEntryId: 101, sourceKey: 'KB-101', language: 'zh-TW', score: 0.9 }],
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      llmCalled: true,
      answerMode: 'diagnosis_rag',
    });

    mockLeadPromptEnricher.enrich.mockResolvedValue({
      content: '回覆內容\n\n留資引導',
      leadPrompted: true,
      highIntentResult: { isHighIntent: true, score: 2, matchedKeywords: ['報價'] },
    });

    mockConversationService.updateConversation.mockResolvedValue({});
    mockConversationService.addMessage.mockResolvedValueOnce({ id: 11 }).mockResolvedValueOnce({ id: 12 });
    mockAuditService.log.mockResolvedValue(undefined);
  });

  it('canHandle product-diagnosis + null context returns true', () => {
    expect(service.canHandle('product-diagnosis', null)).toBe(true);
  });

  it('canHandle collecting context returns true', () => {
    expect(service.canHandle(null, collectingContext)).toBe(true);
  });

  it('canHandle complete context returns true', () => {
    expect(service.canHandle(null, completeContext)).toBe(true);
  });

  it('canHandle recommended context returns false', () => {
    expect(service.canHandle(null, recommendedContext)).toBe(false);
  });

  it('canHandle product-diagnosis + recommended context returns false', () => {
    expect(service.canHandle('product-diagnosis', recommendedContext)).toBe(false);
  });

  it('product-diagnosis with null context initializes and asks purpose', async () => {
    mockDiagnosisService.startOrContinue.mockReturnValue(collectingContext);
    mockDiagnosisService.getNextQuestion.mockReturnValue('請問您的使用用途是什麼？');

    const result = await service.handle({
      conversation: makeConversation(null),
      userMessage: '我想找產品',
      requestId: 'req-1',
      language: 'zh-TW',
      history: [],
      intentLabel: 'product-diagnosis',
      abortSignal: new AbortController().signal,
      startMs: Date.now() - 10,
    });

    expect(result.handled).toBe(true);
    expect(mockDiagnosisService.startOrContinue).toHaveBeenCalledWith(null);
    expect(mockDiagnosisService.processAnswer).not.toHaveBeenCalled();
    expect(mockConversationService.updateConversation).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ diagnosisContext: collectingContext }),
    );
  });

  it('collecting context processes answer and asks next question', async () => {
    const updated: DiagnosisContext = {
      ...collectingContext,
      collectedFields: { purpose: '室外照明' },
      currentField: 'material',
    };

    mockDiagnosisService.startOrContinue.mockReturnValue(collectingContext);
    mockDiagnosisService.processAnswer.mockReturnValue(updated);
    mockDiagnosisService.getNextQuestion.mockReturnValue('請問您需要的材質是什麼？');

    const result = await service.handle({
      conversation: makeConversation(collectingContext),
      userMessage: '室外照明',
      requestId: 'req-2',
      language: 'zh-TW',
      history: [],
      intentLabel: 'product-diagnosis',
      abortSignal: new AbortController().signal,
      startMs: Date.now() - 10,
    });

    expect(result.handled).toBe(true);
    expect(mockDiagnosisService.processAnswer).toHaveBeenCalledWith(
      collectingContext,
      'purpose',
      '室外照明',
    );
    expect(mockDiagnosisService.getNextQuestion).toHaveBeenCalledWith(updated, 'zh-TW');
  });

  it('collecting context continues even when intentLabel is null', async () => {
    const progressed: DiagnosisContext = {
      ...collectingContext,
      collectedFields: { purpose: '室外照明', material: '鋁' },
      currentField: 'length',
    };

    mockDiagnosisService.startOrContinue.mockReturnValue({
      ...collectingContext,
      collectedFields: { purpose: '室外照明' },
      currentField: 'material',
    });
    mockDiagnosisService.processAnswer.mockReturnValue(progressed);

    const result = await service.handle({
      conversation: makeConversation({
        ...collectingContext,
        collectedFields: { purpose: '室外照明' },
        currentField: 'material',
      }),
      userMessage: '鋁',
      requestId: 'req-3',
      language: 'zh-TW',
      history: [],
      intentLabel: null,
      abortSignal: new AbortController().signal,
      startMs: Date.now() - 10,
    });

    expect(result.handled).toBe(true);
    expect(mockDiagnosisService.processAnswer).toHaveBeenCalled();
  });

  it('collecting stage does not call DiagnosisRecommendationService', async () => {
    mockDiagnosisService.startOrContinue.mockReturnValue(collectingContext);

    await service.handle({
      conversation: makeConversation(collectingContext),
      userMessage: '我想找產品',
      requestId: 'req-4',
      language: 'zh-TW',
      history: [],
      intentLabel: 'product-diagnosis',
      abortSignal: new AbortController().signal,
      startMs: Date.now() - 10,
    });

    expect(mockDiagnosisRecommendationService.recommend).not.toHaveBeenCalled();
  });

  it('complete context calls DiagnosisRecommendationService', async () => {
    mockDiagnosisService.startOrContinue.mockReturnValue(completeContext);

    const result = await service.handle({
      conversation: makeConversation(completeContext),
      userMessage: '請推薦',
      requestId: 'req-5',
      language: 'zh-TW',
      history: [],
      intentLabel: null,
      abortSignal: new AbortController().signal,
      startMs: Date.now() - 10,
    });

    expect(result.handled).toBe(true);
    expect(mockDiagnosisRecommendationService.recommend).toHaveBeenCalled();
  });

  it('complete result updates diagnosisContext to recommended', async () => {
    mockDiagnosisService.startOrContinue.mockReturnValue(completeContext);

    await service.handle({
      conversation: makeConversation(completeContext),
      userMessage: '請推薦',
      requestId: 'req-6',
      language: 'zh-TW',
      history: [],
      intentLabel: null,
      abortSignal: new AbortController().signal,
      startMs: Date.now() - 10,
    });

    expect(mockConversationService.updateConversation).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        diagnosisContext: expect.objectContaining({
          stage: 'recommended',
          currentField: null,
          matchedKnowledgeIds: [101],
        }),
      }),
    );
  });

  it('writes diagnosis_progress audit event', async () => {
    mockDiagnosisService.startOrContinue.mockReturnValue(collectingContext);

    await service.handle({
      conversation: makeConversation(collectingContext),
      userMessage: '我想找產品',
      requestId: 'req-7',
      language: 'zh-TW',
      history: [],
      intentLabel: 'product-diagnosis',
      abortSignal: new AbortController().signal,
      startMs: Date.now() - 10,
    });

    expect(mockAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'diagnosis_progress',
        llmCalled: false,
      }),
    );
  });

  it('writes diagnosis_recommended audit event', async () => {
    mockDiagnosisService.startOrContinue.mockReturnValue(completeContext);

    await service.handle({
      conversation: makeConversation(completeContext),
      userMessage: '請推薦',
      requestId: 'req-8',
      language: 'zh-TW',
      history: [],
      intentLabel: null,
      abortSignal: new AbortController().signal,
      startMs: Date.now() - 10,
    });

    expect(mockAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'diagnosis_recommended',
        llmCalled: true,
      }),
    );
  });

  it('calls LeadPromptEnricherService', async () => {
    mockDiagnosisService.startOrContinue.mockReturnValue(completeContext);

    await service.handle({
      conversation: makeConversation(completeContext),
      userMessage: '請推薦',
      requestId: 'req-9',
      language: 'zh-TW',
      history: [],
      intentLabel: null,
      abortSignal: new AbortController().signal,
      startMs: Date.now() - 10,
    });

    expect(mockLeadPromptEnricher.enrich).toHaveBeenCalled();
  });

  it('donePayload.leadPrompted is returned correctly', async () => {
    mockDiagnosisService.startOrContinue.mockReturnValue(completeContext);

    const result = await service.handle({
      conversation: makeConversation(completeContext),
      userMessage: '請推薦',
      requestId: 'req-10',
      language: 'zh-TW',
      history: [],
      intentLabel: null,
      abortSignal: new AbortController().signal,
      startMs: Date.now() - 10,
    });

    expect(result.donePayload?.leadPrompted).toBe(true);
  });
});
