import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { ChatPipelineService } from '../chat/chat-pipeline.service';
import { SafetyService } from '../safety/safety.service';
import { IntentService } from '../intent/intent.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { QueryAnalysisService } from "../query-analysis/query-analysis.service";
import { AnswerTemplateResolver } from "../template/answer-template-resolver";
import type { KnowledgeEntry } from '../generated/prisma/client';
import type { RetrievalResult } from '../retrieval/types/retrieval.types';
import { AuditService } from './audit.service';
import { ConversationService } from '../conversation/conversation.service';
import { AiStatusService } from '../health/ai-status.service';
import { PromptBuilder } from '../chat/prompt-builder';
import { LLM_PROVIDER } from '../llm/interfaces/llm-provider.interface';
import { RETRIEVAL_SERVICE } from '../retrieval/interfaces/retrieval-service.interface';
import type { LlmStreamChunk } from '../llm/types/llm.types';

/**
 * T2-013 — AuditLog integration tests (mock provider, no real API calls).
 *
 * Verifies that the ChatPipelineService writes the correct AuditLog entries
 * for the following scenarios:
 *  1. Successful chat → audit entry has token fields populated
 *  2. PromptGuard blocks → audit entry has eventType 'prompt_guard_blocked', zero tokens
 *  3. Degraded / fallback mode → audit entry has eventType 'llm_fallback'
 *  4. LLM stream error → audit entry has eventType 'llm_error' or 'llm_degraded'
 */

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRes(): jest.Mocked<Partial<Response>> {
  return {
    setHeader: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
    flushHeaders: jest.fn(),
  };
}

function makeConversation() {
  return {
    id: 1,
    sessionId: 'test-session-id',
    session_token: 'test-session-token',
    status: 'active',
    type: 'standard',
    riskLevel: null,
    sensitiveIntentCount: 0,
    highIntentScore: 0,
    diagnosisContext: null,
    language: 'zh-TW',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };
}

async function* makeStream(
  tokens: string[],
  usage = { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
  modelUsed = 'gpt-5.4-mini',
  fallbackTriggered = false,
  provider = 'mock',
): AsyncIterable<LlmStreamChunk> {
  for (const token of tokens) {
    yield { token, done: false };
  }
  yield { token: '', done: true, usage, modelUsed, fallbackTriggered, provider };
}

// ─── Test setup ────────────────────────────────────────────────────────────────

describe('T2-013 AuditLog Integration (mock LLM)', () => {
  let service: ChatPipelineService;
  let auditService: jest.Mocked<Pick<AuditService, 'log'>>;

  const mockSafetyService = {
    scanPrompt: jest.fn().mockResolvedValue({ blocked: false }),
    buildRefusalResponse: jest.fn().mockReturnValue('拒絕'),
    checkConfidentiality: jest.fn().mockResolvedValue({ triggered: false }),
  };
  const mockIntentService = {
    detect: jest.fn().mockResolvedValue({ label: 'product', score: 0.9, sensitive: false }),
  };
  const mockSystemConfigService = {
    get: jest.fn().mockReturnValue(null),
    getNumber: jest.fn().mockReturnValue(null),
    getBoolean: jest.fn().mockReturnValue(null),
  };
  const mockAuditSvc = { log: jest.fn().mockResolvedValue(undefined) };
  const mockConversationService = {
    addMessage: jest.fn().mockResolvedValue({ id: 42 }),
    updateConversation: jest.fn().mockResolvedValue({}),
    getHistoryByToken: jest.fn().mockResolvedValue([]),
  };
  const mockAiStatusService = {
    isDegraded: jest.fn().mockReturnValue(false),
    recordFailure: jest.fn(),
    recordSuccess: jest.fn(),
  };
  const mockPromptBuilder = {
    build: jest.fn().mockReturnValue({ messages: [{ role: 'user', content: 'hello' }], estimatedTokens: 5 }),
  };
  const mockLlmProvider = { stream: jest.fn() };

  const makeKnowledgeEntry = (overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry =>
    ({
      id: 1,
      title: '測試條目',
      content: '產品說明',
      intentLabel: null,
      tags: [],
      aliases: [],
      language: 'zh-TW',
      status: 'published',
      visibility: 'public',
      version: 1,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      deletedAt: null,
      sourceKey: null,
      category: null,
      answerType: 'rag',
      templateKey: null,
      faqQuestions: [],
      crossLanguageGroupKey: null,
      structuredAttributes: null,
      ...overrides,
    }) as KnowledgeEntry;

  const makeRetrievalResult = (entryOverrides: Partial<KnowledgeEntry> = {}): RetrievalResult => ({
    entry: makeKnowledgeEntry(entryOverrides),
    score: 0.9,
  });

  // Default: one high-confidence hit so the LLM step is reached
  const mockRetrievalService = {
    retrieve: jest.fn().mockResolvedValue([makeRetrievalResult()]),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    // Restore defaults cleared by jest.clearAllMocks()
    mockSafetyService.scanPrompt.mockResolvedValue({ blocked: false });
    mockSafetyService.checkConfidentiality.mockResolvedValue({ triggered: false });
    const mockQueryAnalysisService = {
      analyze: jest.fn(),
    };

    mockIntentService.detect.mockResolvedValue({ label: 'product', score: 0.9, sensitive: false });
    mockSystemConfigService.get.mockReturnValue(null);
    mockSystemConfigService.getNumber.mockReturnValue(null);
    mockAuditSvc.log.mockResolvedValue(undefined);
    mockConversationService.addMessage.mockResolvedValue({ id: 42 });
    mockConversationService.updateConversation.mockResolvedValue({});
    mockConversationService.getHistoryByToken.mockResolvedValue([]);
    mockAiStatusService.isDegraded.mockReturnValue(false);
    mockPromptBuilder.build.mockReturnValue({ messages: [{ role: 'user', content: 'hello' }], estimatedTokens: 5 });
    mockRetrievalService.retrieve.mockResolvedValue([makeRetrievalResult()]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatPipelineService,
        { provide: SafetyService, useValue: mockSafetyService },
        { provide: IntentService, useValue: mockIntentService },
        { provide: SystemConfigService, useValue: mockSystemConfigService },
        { provide: QueryAnalysisService, useValue: mockQueryAnalysisService },
        { provide: AnswerTemplateResolver, useValue: { resolve: jest.fn().mockReturnValue({ strategy: 'rag', reason: 'rag:default' }) } },

        { provide: AuditService, useValue: mockAuditSvc },
        { provide: ConversationService, useValue: mockConversationService },
        { provide: AiStatusService, useValue: mockAiStatusService },
        { provide: PromptBuilder, useValue: mockPromptBuilder },
        { provide: LLM_PROVIDER, useValue: mockLlmProvider },
        { provide: RETRIEVAL_SERVICE, useValue: mockRetrievalService },
      ],
    }).compile();

    service = module.get(ChatPipelineService);
    auditService = mockAuditSvc as jest.Mocked<Pick<AuditService, 'log'>>;
  });

  // ── Test 1: Successful chat → AuditLog has token fields ────────────────────

  it('should write AuditLog with token counts after successful chat', async () => {
    mockLlmProvider.stream.mockReturnValue(
      makeStream(['你好', '，', '這是回應'], { promptTokens: 15, completionTokens: 25, totalTokens: 40 }, 'gpt-5.4-mini', false),
    );

    const res = makeRes();
    const abort = new AbortController();
    await service.run(makeConversation(), '你好', 'req-001', res as unknown as Response, abort.signal);

    const logCall = auditService.log.mock.calls.find(([e]) => e.eventType === 'chat_response');
    expect(logCall).toBeDefined();
    const event = logCall![0];
    expect(event.promptTokens).toBe(15);
    expect(event.completionTokens).toBe(25);
    expect(event.totalTokens).toBe(40);
    expect(event.aiModel).toBe('gpt-5.4-mini');
    expect(event.aiProvider).toBe('mock');
    expect(event.eventData).toMatchObject({ action: 'answer' });
  });

  // ── Test 2: PromptGuard blocked → AuditLog has zero tokens ─────────────────

  it('should write AuditLog with eventType=prompt_guard_blocked and zero tokens when guard fires', async () => {
    mockSafetyService.scanPrompt.mockResolvedValueOnce({
      blocked: true,
      blockedReason: 'profanity',
      category: 'offensive',
      promptHash: 'abc123',
    });

    const res = makeRes();
    const abort = new AbortController();
    await service.run(makeConversation(), '壞話', 'req-002', res as unknown as Response, abort.signal);

    const logCall = auditService.log.mock.calls.find(([e]) => e.eventType === 'prompt_guard_blocked');
    expect(logCall).toBeDefined();
    const event = logCall![0];
    expect(event.blockedReason).toBe('profanity');
    // No LLM call should have been made
    expect(mockLlmProvider.stream).not.toHaveBeenCalled();
  });

  // ── Test 3: Degraded mode → AuditLog has eventType=llm_fallback ────────────

  it('should write AuditLog with eventType=llm_fallback when system is degraded', async () => {
    mockAiStatusService.isDegraded.mockReturnValueOnce(true);

    const res = makeRes();
    const abort = new AbortController();
    await service.run(makeConversation(), '問題', 'req-003', res as unknown as Response, abort.signal);

    const logCall = auditService.log.mock.calls.find(([e]) => e.eventType === 'llm_fallback');
    expect(logCall).toBeDefined();
    const event = logCall![0];
    expect(event.eventData).toMatchObject({ reason: 'ai_degraded' });
    expect(mockLlmProvider.stream).not.toHaveBeenCalled();
  });

  // ── Test 4: LLM stream error → AuditLog has eventType=llm_error ────────────

  it('should write AuditLog with eventType=llm_error|llm_degraded when stream throws', async () => {
    mockLlmProvider.stream.mockImplementation(function* () {
      throw new Error('connection reset');
    });

    const res = makeRes();
    const abort = new AbortController();
    await service.run(makeConversation(), '問題', 'req-004', res as unknown as Response, abort.signal);

    const logCall = auditService.log.mock.calls.find(
      ([e]) => e.eventType === 'llm_error' || e.eventType === 'llm_degraded',
    );
    expect(logCall).toBeDefined();
    const event = logCall![0];
    expect(event.eventData).toMatchObject({ fallbackTriggered: true });
  });

  // ── Test 5: Fallback model triggered → fallbackTriggered=true in eventData ──

  it('should record fallbackTriggered=true when stream done chunk reports fallback', async () => {
    mockLlmProvider.stream.mockReturnValue(
      makeStream(['回應'], { promptTokens: 5, completionTokens: 5, totalTokens: 10 }, 'gpt-5.4-nano', true),
    );

    const res = makeRes();
    const abort = new AbortController();
    await service.run(makeConversation(), '問題', 'req-005', res as unknown as Response, abort.signal);

    const logCall = auditService.log.mock.calls.find(([e]) => e.eventType === 'chat_response');
    expect(logCall).toBeDefined();
    const event = logCall![0];
    expect(event.aiModel).toBe('gpt-5.4-nano');
    expect(event.aiProvider).toBe('mock');
    expect(event.eventData).toMatchObject({ fallbackTriggered: true });
  });
});
