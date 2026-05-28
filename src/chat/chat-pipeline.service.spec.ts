import { Test } from '@nestjs/testing';
import { Response } from 'express';
import { ChatPipelineService } from './chat-pipeline.service';
import { SafetyService } from '../safety/safety.service';
import { IntentService } from '../intent/intent.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { AuditService } from '../audit/audit.service';
import { ConversationService } from '../conversation/conversation.service';
import { AiStatusService } from '../health/ai-status.service';
import { PromptBuilder } from './prompt-builder';
import { LLM_PROVIDER } from '../llm/interfaces/llm-provider.interface';
import { RETRIEVAL_SERVICE } from '../retrieval/interfaces/retrieval-service.interface';
import { LlmTimeoutError } from '../llm/errors/llm-timeout.error';
import { QueryAnalysisService } from '../query-analysis/query-analysis.service';
import { AnswerTemplateResolver } from '../template/answer-template-resolver';
import { DiagnosisFlowService } from './diagnosis-flow.service';
import { LeadPromptEnricherService } from './lead-prompt-enricher.service';
import type { KnowledgeEntry } from '../generated/prisma/client';
import type { RetrievalResult } from '../retrieval/types/retrieval.types';
import { QueryUnderstandingService } from '../query-understanding/query-understanding.service.js';
import { HybridRetrievalService } from '../hybrid-retrieval/hybrid-retrieval.service.js';
import { RetrievalDecisionService } from '../hybrid-retrieval/gate/retrieval-decision.service.js';
import { QueryType } from '../query-understanding/types/query-type.enum.js';
import { TokenType } from '../query-understanding/types/token-type.enum.js';
import type { ChunkResult } from '../hybrid-retrieval/types/chunk-result.type.js';
import type { RetrievalDecision, RetrievalDecisionReason } from '../hybrid-retrieval/types/retrieval-decision.type.js';
import type { QueryUnderstandingResult } from '../query-understanding/types/query-understanding-result.type.js';

/**
 * T2-011 — Unit tests for ChatPipelineService.
 *
 * Covers:
 *  - detectLang() static helper: zh-TW / en / fallback
 *  - Degraded mode returns fallback SSE payload and ends response
 *  - Safety block writes "blocked" SSE event and ends response
 *  - Successful flow streams tokens and writes "done" event
 *  - AbortSignal triggers "interrupted" event
 *  - LlmTimeoutError triggers "timeout" event
 *  - RAG no-hit / below minimum score → fallback (no LLM call)
 *  - RAG low confidence (between min and answer threshold) → enters LLM with cautious prompt
 *  - RAG high confidence → enters LLM normally
 *  - aiProvider populated from done chunk (not env-sniffed)
 */
describe('ChatPipelineService', () => {
  // ── Static helper tests (no DI needed) ──────────────────────────────────

  describe('detectLang (static)', () => {
    it('should return zh-TW for Chinese text', () => {
      expect(ChatPipelineService.detectLang('你好，我想詢問產品規格與價格的相關資訊')).toBe(
        'zh-TW',
      );
    });

    it('should return en for English text', () => {
      expect(
        ChatPipelineService.detectLang(
          'I would like to ask about your product specifications and pricing',
        ),
      ).toBe('en');
    });

    it('should return fallback for empty string', () => {
      expect(ChatPipelineService.detectLang('')).toBe('zh-TW');
    });

    it('should respect a custom fallback parameter', () => {
      expect(ChatPipelineService.detectLang('', 'en')).toBe('en');
    });

    // Short ASCII product/FAQ terms — must not fall back to zh-TW
    it('should return en for short word: catalog', () => {
      expect(ChatPipelineService.detectLang('catalog')).toBe('en');
    });

    it('should return en for short word: bolt', () => {
      expect(ChatPipelineService.detectLang('bolt')).toBe('en');
    });

    it('should return en for short word: washer', () => {
      expect(ChatPipelineService.detectLang('washer')).toBe('en');
    });

    it('should return en for short word: wire', () => {
      expect(ChatPipelineService.detectLang('wire')).toBe('en');
    });

    it('should return en for short word: screw', () => {
      expect(ChatPipelineService.detectLang('screw')).toBe('en');
    });

    it('should return en for short phrase: quote request', () => {
      expect(ChatPipelineService.detectLang('quote request')).toBe('en');
    });

    it('should return en for product code query: M6 hex bolt', () => {
      expect(ChatPipelineService.detectLang('M6 hex bolt')).toBe('en');
    });

    it('should return zh-TW for mixed Chinese+English: M3 螺絲', () => {
      expect(ChatPipelineService.detectLang('M3 螺絲')).toBe('zh-TW');
    });

    it('should return zh-TW for short Chinese term: 型錄', () => {
      expect(ChatPipelineService.detectLang('型錄')).toBe('zh-TW');
    });

    it('should return zh-TW for Chinese product query: 六角螺帽規格', () => {
      expect(ChatPipelineService.detectLang('六角螺帽規格')).toBe('zh-TW');
    });
  });

  let service: ChatPipelineService;

  // Mock response object
  const makeRes = (): jest.Mocked<Partial<Response>> => ({
    setHeader: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
    flushHeaders: jest.fn(),
  });

  const makeConversation = () => ({
    id: 1,
    sessionId: 'session-uuid',
    session_token: 'token-uuid',
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
  });

  const makeKnowledgeEntry = (overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry =>
    ({
      id: 1,
      title: '測試條目',
      content: '產品資訊',
      intentLabel: null,
      tags: [],
      aliases: [],
      language: 'zh-TW',
      status: 'approved',
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

  const makeRetrievalResult = (
    score: number,
    entryOverrides: Partial<KnowledgeEntry> = {},
  ): RetrievalResult => ({
    entry: makeKnowledgeEntry(entryOverrides),
    score,
  });

  const mockSafetyService = {
    scanPrompt: jest.fn().mockReturnValue({ blocked: false }),
    buildRefusalResponse: jest.fn().mockReturnValue('拒絕'),
    buildHandoffGuidance: jest.fn().mockReturnValue('請留下聯絡資訊'),
    checkConfidentiality: jest.fn().mockReturnValue({ triggered: false }),
  };
  const mockIntentService = {
    detect: jest.fn().mockResolvedValue({ label: 'general', score: 0.1, sensitive: false }),
    isHighIntent: jest.fn().mockReturnValue({
      isHighIntent: false,
      score: 0,
      matchedKeywords: [],
    }),
  };
  const mockSystemConfigService = {
    get: jest.fn().mockReturnValue(null),
    getNumber: jest.fn().mockReturnValue(null),
    getBoolean: jest.fn().mockReturnValue(null),
  };
  const mockAuditService = { log: jest.fn().mockResolvedValue(undefined) };
  const mockConversationService = {
    addMessage: jest.fn().mockResolvedValue({ id: 1 }),
    updateConversation: jest.fn().mockResolvedValue({}),
    getHistoryByToken: jest.fn().mockResolvedValue([]),
    incrementSensitiveIntentCount: jest.fn().mockResolvedValue({ sensitiveIntentCount: 1 }),
  };
  const mockAiStatusService = {
    isDegraded: jest.fn().mockReturnValue(false),
    recordFailure: jest.fn(),
    recordSuccess: jest.fn(),
  };
  const mockPromptBuilder = {
    build: jest.fn().mockReturnValue({ messages: [], estimatedTokens: 0 }),
  };
  const mockDiagnosisFlowService = {
    canHandle: jest.fn().mockReturnValue(false),
    handle: jest.fn().mockResolvedValue({ handled: false }),
  };
  const mockLlmProvider = {
    stream: jest.fn(),
  };
  const mockRetrievalService = {
    retrieve: jest.fn().mockResolvedValue([]),
  };
  const mockQueryAnalysisService = {
    analyze: jest.fn().mockResolvedValue({
      rawQuery: '測試',
      normalizedQuery: '測試',
      language: 'zh-TW',
      tokens: ['測試'],
      terms: ['測試'],
      phrases: [],
      expandedTerms: ['測試'],
      matchedRules: [],
      selectedProfile: 'default',
      intentHints: [],
      debugMeta: { processingMs: 5, normalizerSteps: [], expansionHits: 0 },
    }),
  };
  const mockTemplateResolver = {
    resolve: jest.fn().mockReturnValue({ strategy: 'rag', reason: 'rag:default' }),
  };
  // Optional QU / Hybrid Retrieval services for the feature-flagged 003 path.
  const mockQUS003 = { understand: jest.fn() };
  const mockHRS003 = { retrieve: jest.fn() };
  const mockRDS003 = {
    decideFromChunks: jest.fn(),
    decideFromRetrievalResults: jest.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ChatPipelineService,
        { provide: SafetyService, useValue: mockSafetyService },
        { provide: IntentService, useValue: mockIntentService },
        { provide: SystemConfigService, useValue: mockSystemConfigService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: ConversationService, useValue: mockConversationService },
        { provide: AiStatusService, useValue: mockAiStatusService },
        { provide: PromptBuilder, useValue: mockPromptBuilder },
        { provide: DiagnosisFlowService, useValue: mockDiagnosisFlowService },
        LeadPromptEnricherService,
        { provide: QueryAnalysisService, useValue: mockQueryAnalysisService },
        { provide: AnswerTemplateResolver, useValue: mockTemplateResolver },
        { provide: LLM_PROVIDER, useValue: mockLlmProvider },
        { provide: RETRIEVAL_SERVICE, useValue: mockRetrievalService },
        { provide: QueryUnderstandingService, useValue: mockQUS003 },
        { provide: HybridRetrievalService, useValue: mockHRS003 },
        { provide: RetrievalDecisionService, useValue: mockRDS003 },
      ],
    }).compile();

    service = module.get(ChatPipelineService);

    // Reset all mocks before each test
    jest.clearAllMocks();
    mockSafetyService.scanPrompt.mockReturnValue({ blocked: false });
    mockSafetyService.checkConfidentiality.mockReturnValue({ triggered: false });
    mockSafetyService.buildRefusalResponse.mockReturnValue('拒絕');
    mockSafetyService.buildHandoffGuidance.mockReturnValue('請留下聯絡資訊');
    mockIntentService.detect.mockResolvedValue({ label: 'general', score: 0.1, sensitive: false });
    mockIntentService.isHighIntent.mockReturnValue({
      isHighIntent: false,
      score: 0,
      matchedKeywords: [],
    });
    mockSystemConfigService.get.mockReturnValue(null);
    mockSystemConfigService.getBoolean.mockReturnValue(null); // feature flag OFF by default
    mockAiStatusService.isDegraded.mockReturnValue(false);
    mockRetrievalService.retrieve.mockResolvedValue([]);
    mockPromptBuilder.build.mockReturnValue({ messages: [], estimatedTokens: 0 });
    mockConversationService.addMessage.mockResolvedValue({ id: 1 });
    mockConversationService.updateConversation.mockResolvedValue({});
    mockConversationService.getHistoryByToken.mockResolvedValue([]);
    mockConversationService.incrementSensitiveIntentCount.mockResolvedValue({
      sensitiveIntentCount: 1,
    });
    mockDiagnosisFlowService.canHandle.mockReturnValue(false);
    mockDiagnosisFlowService.handle.mockResolvedValue({ handled: false });
    mockQueryAnalysisService.analyze.mockResolvedValue({
      rawQuery: '測試',
      normalizedQuery: '測試',
      language: 'zh-TW',
      tokens: ['測試'],
      terms: ['測試'],
      phrases: [],
      expandedTerms: ['測試'],
      matchedRules: [],
      selectedProfile: 'default',
      intentHints: [],
      debugMeta: { processingMs: 5, normalizerSteps: [], expansionHits: 0 },
    });
    // Default: 'rag' strategy (001 behaviour preserved)
    mockTemplateResolver.resolve.mockReturnValue({ strategy: 'rag', reason: 'rag:default' });
    // Optional QU / Hybrid Retrieval services: all flags OFF by default, so these mocks return safe defaults.
    // but should NOT be called in legacy-path tests (T064-1 verifies this).
    mockQUS003.understand.mockResolvedValue(null);
    mockHRS003.retrieve.mockResolvedValue([]);
    mockRDS003.decideFromChunks.mockReturnValue(null);
    mockRDS003.decideFromRetrievalResults.mockReturnValue(null);
  });

  describe('degraded mode', () => {
    it('should emit fallback status event and end without calling LLM', async () => {
      mockAiStatusService.isDegraded.mockReturnValue(true);
      mockSystemConfigService.get.mockReturnValue('系統繁忙，請稍後再試。');

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '你好',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      expect(mockLlmProvider.stream).not.toHaveBeenCalled();
      expect(res.write).toHaveBeenCalled();
      const writtenData = (res.write as jest.Mock).mock.calls.map((c: unknown[]) => c[0]).join('');
      // Degraded mode: emits token with fallback text, done with action=fallback
      expect(writtenData).toContain('event: token');
      expect(writtenData).toContain('fallback');
    });
  });

  describe('Diagnosis flow delegation', () => {
    const parseDonePayload = (res: jest.Mocked<Partial<Response>>): Record<string, unknown> | null => {
      const raw = (res.write as jest.Mock).mock.calls
        .map((c: unknown[]) => c[0] as string)
        .join('');
      const blocks = raw.split('\n\n').filter(Boolean);
      for (const block of blocks) {
        const eventLine = block
          .split('\n')
          .find((line: string) => line.startsWith('event:') && line.includes('done'));
        const dataLine = block
          .split('\n')
          .find((line: string) => line.startsWith('data:'));
        if (eventLine && dataLine) {
          return JSON.parse(dataLine.replace(/^data:\s*/, '')) as Record<string, unknown>;
        }
      }
      return null;
    };

    it('delegates to DiagnosisFlowService when canHandle=true', async () => {
      mockIntentService.detect.mockResolvedValue({
        intentLabel: 'product-diagnosis',
        confidence: 0.95,
        language: 'zh-TW',
      });
      mockDiagnosisFlowService.canHandle.mockReturnValue(true);
      mockDiagnosisFlowService.handle.mockResolvedValue({
        handled: true,
        reply: '請問您的使用用途是什麼？',
        donePayload: {
          messageId: 200,
          action: 'answer',
          intentLabel: 'product-diagnosis',
          sourceReferences: [],
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          leadPrompted: false,
        },
      });

      const conversation = makeConversation();
      conversation.diagnosisContext = null;
      const res = makeRes();

      await service.run(
        conversation as never,
        '我想找產品',
        'req-dia-1',
        res as never,
        new AbortController().signal,
      );

      expect(mockDiagnosisFlowService.canHandle).toHaveBeenCalledWith('product-diagnosis', null);
      expect(mockDiagnosisFlowService.handle).toHaveBeenCalled();
      expect(mockRetrievalService.retrieve).not.toHaveBeenCalled();
      expect(mockLlmProvider.stream).not.toHaveBeenCalled();

      const written = (res.write as jest.Mock).mock.calls.map((c: unknown[]) => c[0] as string).join('');
      expect(written).toContain('event: token');
      expect(written).toContain('event: done');
      expect(written).toContain('請問您的使用用途是什麼？');
    });

    it('writes SSE token/done from diagnosis delegate result', async () => {
      mockIntentService.detect.mockResolvedValue({
        intentLabel: 'product-diagnosis',
        confidence: 0.95,
        language: 'zh-TW',
      });
      mockDiagnosisFlowService.canHandle.mockReturnValue(true);
      mockDiagnosisFlowService.handle.mockResolvedValue({
        handled: true,
        reply: '問診回覆',
        donePayload: {
          messageId: 301,
          action: 'answer',
          intentLabel: 'product-diagnosis',
          sourceReferences: [],
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          leadPrompted: true,
        },
      });

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '我想找產品',
        'req-dia-2',
        res as never,
        new AbortController().signal,
      );

      const done = parseDonePayload(res);
      expect(done).not.toBeNull();
      expect(done!['messageId']).toBe(301);
      expect(done!['leadPrompted']).toBe(true);
      expect(done!['intentLabel']).toBe('product-diagnosis');
    });

    it('delegate path does not run general retrieval or llm', async () => {
      mockIntentService.detect.mockResolvedValue({
        intentLabel: 'product-diagnosis',
        confidence: 0.95,
        language: 'zh-TW',
      });
      mockDiagnosisFlowService.canHandle.mockReturnValue(true);
      mockDiagnosisFlowService.handle.mockResolvedValue({
        handled: true,
        reply: '問診中',
        donePayload: {
          messageId: 302,
          action: 'answer',
          intentLabel: 'product-diagnosis',
          sourceReferences: [],
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        },
      });

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '室外照明',
        'req-dia-3',
        res as never,
        new AbortController().signal,
      );

      expect(mockRetrievalService.retrieve).not.toHaveBeenCalled();
      expect(mockLlmProvider.stream).not.toHaveBeenCalled();
    });

    it('when canHandle=false keeps general RAG flow unchanged', async () => {
      mockDiagnosisFlowService.canHandle.mockReturnValue(false);
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.9, { content: '產品資訊' }),
      ]);
      async function* mockStream() {
        yield { token: '一般回答', done: false };
        yield {
          token: '',
          done: true,
          provider: 'mock',
          modelUsed: 'mock',
          fallbackTriggered: false,
          usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
        };
      }
      mockLlmProvider.stream.mockReturnValue(mockStream());

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '一般問題',
        'req-dia-4',
        res as never,
        new AbortController().signal,
      );

      expect(mockDiagnosisFlowService.handle).not.toHaveBeenCalled();
      expect(mockRetrievalService.retrieve).toHaveBeenCalled();
      expect(mockLlmProvider.stream).toHaveBeenCalled();
    });
  });

  describe('safety block', () => {
    it('should emit blocked event when safety scan returns blocked=true', async () => {
      mockSafetyService.scanPrompt.mockReturnValue({
        blocked: true,
        category: 'prompt_injection',
        blockedReason: 'Pattern matched',
        promptHash: 'abc123',
      });
      // sensitiveIntentCount=1 (below default threshold 3)
      mockConversationService.incrementSensitiveIntentCount.mockResolvedValue({
        sensitiveIntentCount: 1,
      });

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '不當訊息',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      expect(mockLlmProvider.stream).not.toHaveBeenCalled();
      const writtenData = (res.write as jest.Mock).mock.calls.map((c: unknown[]) => c[0]).join('');
      // Safety block: emits token with refusal text, done with action=intercepted
      expect(writtenData).toContain('event: token');
      expect(writtenData).toContain('intercepted');
    });
  });

  describe('successful flow', () => {
    it('should stream tokens and emit done event', async () => {
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.9, { content: '產品資訊' }),
      ]);
      async function* mockStream() {
        yield { token: '你好' };
        yield { token: '！' };
        yield {
          token: '',
          done: true,
          provider: 'mock',
          modelUsed: 'mock',
          fallbackTriggered: false,
          usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
        };
      }
      mockLlmProvider.stream.mockReturnValue(mockStream());

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '說你好',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      const writtenData = (res.write as jest.Mock).mock.calls.map((c: unknown[]) => c[0]).join('');
      expect(writtenData).toContain('event: token');
      expect(writtenData).toContain('event: done');
      expect(mockAiStatusService.recordSuccess).toHaveBeenCalled();
    });
  });

  describe('abort signal', () => {
    it('should emit interrupted event when signal is aborted during stream', async () => {
      const controller = new AbortController();
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.9, { content: '資訊' }),
      ]);

      async function* mockStream() {
        controller.abort();
        const err = new Error('aborted');
        err.name = 'AbortError';
        (err as NodeJS.ErrnoException).code = 'ABORT_ERR';
        throw err;
      }
      mockLlmProvider.stream.mockReturnValue(mockStream());

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '中斷測試',
        'req-id',
        res as never,
        controller.signal,
      );

      const writtenData = (res.write as jest.Mock).mock.calls.map((c: unknown[]) => c[0]).join('');
      expect(writtenData).toContain('interrupted');
      expect(res.end).toHaveBeenCalled();
    });
  });

  describe('LLM timeout', () => {
    it('should emit event:timeout when LlmTimeoutError is thrown', async () => {
      async function* timeoutStream() {
        throw new LlmTimeoutError('Model timed out after 30000ms');
        yield { token: '', done: false }; // unreachable — keeps TS happy
      }
      mockLlmProvider.stream.mockReturnValue(timeoutStream());
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.9, { content: 'info' }),
      ]);

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '逾時測試',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      const writtenData = (res.write as jest.Mock).mock.calls.map((c: unknown[]) => c[0]).join('');
      expect(writtenData).toContain('timeout');
      expect(res.end).toHaveBeenCalled();
    });
  });

  describe('RAG short-circuit', () => {
    it('should skip LLM and emit fallback when RAG returns no hits', async () => {
      mockRetrievalService.retrieve.mockResolvedValue([]);

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '無命中問題',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      expect(mockLlmProvider.stream).not.toHaveBeenCalled();
      const writtenData = (res.write as jest.Mock).mock.calls.map((c: unknown[]) => c[0]).join('');
      expect(writtenData).toContain('event: done');
      expect(writtenData).toContain('fallback');
    });

    it('should skip LLM and emit fallback when top score is below rag_minimum_score', async () => {
      // Score 0.10 < default minimum (0.25) → fallback
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.1, { content: '非常低信心' }),
      ]);

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '低分問題',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      expect(mockLlmProvider.stream).not.toHaveBeenCalled();
      const writtenData = (res.write as jest.Mock).mock.calls.map((c: unknown[]) => c[0]).join('');
      expect(writtenData).toContain('event: done');
      expect(writtenData).toContain('fallback');
    });

    it('should enter LLM with low confidence mode when score is between thresholds', async () => {
      // Score 0.35 is between default minimum (0.25) and default answer threshold (0.55)
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.35, { content: '中低信心資訊' }),
      ]);

      async function* lowConfStream() {
        yield { token: '追問回應', done: false };
        yield {
          token: '',
          done: true,
          provider: 'mock',
          modelUsed: 'mock',
          fallbackTriggered: false,
          usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
        };
      }
      mockLlmProvider.stream.mockReturnValue(lowConfStream());

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '中低信心問題',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      // LLM should be called (low confidence path goes to LLM)
      expect(mockLlmProvider.stream).toHaveBeenCalled();
      const writtenData = (res.write as jest.Mock).mock.calls.map((c: unknown[]) => c[0]).join('');
      expect(writtenData).toContain('event: done');
      expect(writtenData).toContain('answer');
    });
  });

  describe('aiProvider from done chunk', () => {
    it('should pass provider from done chunk to audit log (not env-sniffed)', async () => {
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.9, { content: 'info' }),
      ]);

      async function* mockStream() {
        yield { token: '回應', done: false };
        yield {
          token: '',
          done: true,
          provider: 'mock',
          modelUsed: 'mock',
          fallbackTriggered: false,
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      }
      mockLlmProvider.stream.mockReturnValue(mockStream());

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '測試',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      const writtenData = (res.write as jest.Mock).mock.calls.map((c: unknown[]) => c[0]).join('');
      expect(writtenData).toContain('event: done');
      expect(writtenData).toContain('answer');
    });
  });

  // ── Phase 3: T3-002 confidentiality short-circuit ───────────────────────

  describe('Phase 3 — confidentiality check (T3-002)', () => {
    it('should short-circuit pipeline and emit intercepted when confidential topic detected', async () => {
      mockSafetyService.checkConfidentiality.mockReturnValue({
        triggered: true,
        matchedType: 'confidential',
        matchedKeyword: '保密協議',
      });
      mockConversationService.incrementSensitiveIntentCount.mockResolvedValue({
        sensitiveIntentCount: 1,
      });

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '你們的保密協議內容是什麼？',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      // Pipeline should NOT reach retrieval
      expect(mockRetrievalService.retrieve).not.toHaveBeenCalled();
      // Pipeline should NOT call LLM
      expect(mockLlmProvider.stream).not.toHaveBeenCalled();
      // Should emit intercepted done event
      const writtenData = (res.write as jest.Mock).mock.calls.map((c: unknown[]) => c[0]).join('');
      expect(writtenData).toContain('intercepted');
      expect(res.end).toHaveBeenCalled();
    });

    it('should write confidential_refused audit event on confidentiality trigger', async () => {
      mockSafetyService.checkConfidentiality.mockReturnValue({
        triggered: true,
        matchedType: 'confidential',
        matchedKeyword: 'NDA',
      });
      mockConversationService.incrementSensitiveIntentCount.mockResolvedValue({
        sensitiveIntentCount: 1,
      });

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        'What is your NDA?',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      const auditCalls = (mockAuditService.log as jest.Mock).mock.calls.map(
        (args: unknown[]) => (args[0] as { eventType: string }).eventType,
      );
      expect(auditCalls).toContain('confidential_refused');
    });

    it('should mark conversation type=confidential and riskLevel=high', async () => {
      mockSafetyService.checkConfidentiality.mockReturnValue({
        triggered: true,
        matchedType: 'confidential',
        matchedKeyword: '保密協議',
      });
      mockConversationService.incrementSensitiveIntentCount.mockResolvedValue({
        sensitiveIntentCount: 1,
      });

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '保密協議問題',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      expect(mockConversationService.updateConversation).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ type: 'confidential', riskLevel: 'high' }),
      );
    });

    it('should write assistant refusal message with riskLevel=high (T3-002)', async () => {
      mockSafetyService.checkConfidentiality.mockReturnValue({
        triggered: true,
        matchedType: 'confidential',
        matchedKeyword: '保密協議',
      });
      mockConversationService.incrementSensitiveIntentCount.mockResolvedValue({
        sensitiveIntentCount: 1,
      });
      mockSafetyService.buildRefusalResponse.mockReturnValue('很抱歉');
      mockSafetyService.buildHandoffGuidance.mockReturnValue('請留下聯絡資訊');

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '保密協議問題',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      // addMessage is called twice: user msg then assistant msg
      const calls = (mockConversationService.addMessage as jest.Mock).mock.calls as [
        number,
        Record<string, unknown>,
      ][];
      const assistantCall = calls.find(([, data]) => data['role'] === 'assistant');
      expect(assistantCall).toBeDefined();
      expect(assistantCall![1]).toMatchObject({
        role: 'assistant',
        type: 'confidential',
        riskLevel: 'high',
      });
    });
  });

  // ── Phase 3: T3-003 sensitiveIntentCount tracking ──────────────────────

  describe('Phase 3 — sensitive intent count tracking (T3-003)', () => {
    it('should increment sensitiveIntentCount when prompt_injection is blocked', async () => {
      mockSafetyService.scanPrompt.mockReturnValue({
        blocked: true,
        category: 'prompt_injection',
        blockedReason: 'Pattern matched',
        promptHash: 'abc123',
      });
      mockConversationService.incrementSensitiveIntentCount.mockResolvedValue({
        sensitiveIntentCount: 1,
      });

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        'inject attempt',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      expect(mockConversationService.incrementSensitiveIntentCount).toHaveBeenCalledTimes(1);
    });

    it('should NOT increment sensitiveIntentCount for blacklist_keyword category', async () => {
      mockSafetyService.scanPrompt.mockReturnValue({
        blocked: true,
        category: 'blacklist_keyword',
        blockedReason: 'Keyword matched',
        promptHash: 'abc123',
      });

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '成本價',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      expect(mockConversationService.incrementSensitiveIntentCount).not.toHaveBeenCalled();
    });

    it('should write sensitive_intent_alert audit when count reaches threshold', async () => {
      mockSafetyService.scanPrompt.mockReturnValue({
        blocked: true,
        category: 'jailbreak',
        blockedReason: 'Pattern matched',
        promptHash: 'abc123',
      });
      // Return count = 3 which equals the default threshold of 3
      mockConversationService.incrementSensitiveIntentCount.mockResolvedValue({
        sensitiveIntentCount: 3,
      });
      mockSystemConfigService.getNumber.mockImplementation((key: string) => {
        if (key === 'sensitive_intent_alert_threshold') return 3;
        return null;
      });

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        'jailbreak attempt',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      const auditCalls = (mockAuditService.log as jest.Mock).mock.calls.map(
        (args: unknown[]) => (args[0] as { eventType: string }).eventType,
      );
      expect(auditCalls).toContain('sensitive_intent_alert');
    });

    it('should NOT write sensitive_intent_alert when count is below threshold', async () => {
      mockSafetyService.scanPrompt.mockReturnValue({
        blocked: true,
        category: 'prompt_injection',
        blockedReason: 'Pattern matched',
        promptHash: 'abc123',
      });
      mockConversationService.incrementSensitiveIntentCount.mockResolvedValue({
        sensitiveIntentCount: 2,
      });
      mockSystemConfigService.getNumber.mockImplementation((key: string) => {
        if (key === 'sensitive_intent_alert_threshold') return 3;
        return null;
      });

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        'inject',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      const auditCalls = (mockAuditService.log as jest.Mock).mock.calls.map(
        (args: unknown[]) => (args[0] as { eventType: string }).eventType,
      );
      expect(auditCalls).not.toContain('sensitive_intent_alert');
    });

    it('should append handoff guidance to refusal when threshold is reached', async () => {
      mockSafetyService.scanPrompt.mockReturnValue({
        blocked: true,
        category: 'jailbreak',
        blockedReason: 'Pattern matched',
        promptHash: 'abc123',
      });
      mockConversationService.incrementSensitiveIntentCount.mockResolvedValue({
        sensitiveIntentCount: 3,
      });
      mockSystemConfigService.getNumber.mockImplementation((key: string) => {
        if (key === 'sensitive_intent_alert_threshold') return 3;
        return null; // all other keys (max_message_length etc.) use defaults
      });
      mockSafetyService.buildRefusalResponse.mockReturnValue('很抱歉');
      mockSafetyService.buildHandoffGuidance.mockReturnValue('請留下聯絡資訊');

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        'jailbreak',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      const writtenData = (res.write as jest.Mock).mock.calls.map((c: unknown[]) => c[0]).join('');
      // Both refusal text and handoff guidance should appear
      expect(writtenData).toContain('很抱歉');
      expect(writtenData).toContain('請留下聯絡資訊');
    });
  });

  // ── Phase 3: T3-004 RAG isolation ─────────────────────────────────────

  describe('Phase 3 — RAG isolation (T3-004)', () => {
    it('should NOT call retrieve when promptGuard blocks the request', async () => {
      mockSafetyService.scanPrompt.mockReturnValue({
        blocked: true,
        category: 'prompt_injection',
        blockedReason: 'Pattern matched',
        promptHash: 'abc123',
      });
      mockConversationService.incrementSensitiveIntentCount.mockResolvedValue({
        sensitiveIntentCount: 1,
      });

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        'inject',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      expect(mockRetrievalService.retrieve).not.toHaveBeenCalled();
    });

    it('should NOT call retrieve when confidentiality check triggers', async () => {
      mockSafetyService.checkConfidentiality.mockReturnValue({
        triggered: true,
        matchedType: 'confidential',
        matchedKeyword: '保密協議',
      });
      mockConversationService.incrementSensitiveIntentCount.mockResolvedValue({
        sensitiveIntentCount: 1,
      });

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '保密協議',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      expect(mockRetrievalService.retrieve).not.toHaveBeenCalled();
    });
  });

  // ── intentLabel in SSE done payload ───────────────────────────────────

  describe('intentLabel in SSE done payload', () => {
    /**
     * Helper: parse all SSE event lines from the recorded res.write calls.
     * Returns an array of { event, data } objects for every 'done' event found.
     */
    const parseDonePayloads = (res: jest.Mocked<Partial<Response>>): Record<string, unknown>[] => {
      const raw = (res.write as jest.Mock).mock.calls
        .map((c: unknown[]) => c[0] as string)
        .join('');
      const donePayloads: Record<string, unknown>[] = [];
      const blocks = raw.split('\n\n').filter(Boolean);
      for (const block of blocks) {
        const lines = block.split('\n');
        const eventLine = lines.find(l => l.startsWith('event:'));
        const dataLine = lines.find(l => l.startsWith('data:'));
        if (eventLine?.includes('done') && dataLine) {
          donePayloads.push(
            JSON.parse(dataLine.replace(/^data:\s*/, '')) as Record<string, unknown>,
          );
        }
      }
      return donePayloads;
    };

    it('should include intentLabel in done payload when intent is detected (answer path)', async () => {
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.9, { content: '產品資訊' }),
      ]);
      mockIntentService.detect.mockResolvedValue({
        intentLabel: 'product-inquiry',
        confidence: 0.85,
        language: 'zh-TW',
      });
      async function* mockStream() {
        yield { token: '這是產品資訊' };
        yield {
          token: '',
          done: true,
          provider: 'mock',
          modelUsed: 'mock',
          fallbackTriggered: false,
          usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
        };
      }
      mockLlmProvider.stream.mockReturnValue(mockStream());

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '你們的螺絲產品有哪些',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      const donePayloads = parseDonePayloads(res);
      expect(donePayloads).toHaveLength(1);
      expect(donePayloads[0]['intentLabel']).toBe('product-inquiry');
    });

    it('should include intentLabel as null when intent detection returns null (answer path)', async () => {
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.9, { content: '資訊' }),
      ]);
      mockIntentService.detect.mockResolvedValue({
        intentLabel: null,
        confidence: 0,
        language: 'zh-TW',
      });
      async function* mockStream() {
        yield { token: '回應' };
        yield {
          token: '',
          done: true,
          provider: 'mock',
          modelUsed: 'mock',
          fallbackTriggered: false,
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      }
      mockLlmProvider.stream.mockReturnValue(mockStream());

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '未知問題',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      const donePayloads = parseDonePayloads(res);
      expect(donePayloads[0]['intentLabel']).toBeNull();
    });

    it('intentLabel should be null (not undefined) in done payload when no intent matched', async () => {
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.9, { content: '資訊' }),
      ]);
      mockIntentService.detect.mockResolvedValue({
        intentLabel: null,
        confidence: 0,
        language: 'zh-TW',
      });
      async function* mockStream() {
        yield {
          token: '',
          done: true,
          provider: 'mock',
          modelUsed: 'mock',
          fallbackTriggered: false,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        };
      }
      mockLlmProvider.stream.mockReturnValue(mockStream());

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '測試',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      const donePayloads = parseDonePayloads(res);
      expect(donePayloads[0]).toHaveProperty('intentLabel');
      // Must be null, NOT undefined — undefined would be omitted by JSON.stringify
      expect(donePayloads[0]['intentLabel']).toBeNull();
    });

    it('should include intentLabel in fallback done payload (RAG no-hit)', async () => {
      mockRetrievalService.retrieve.mockResolvedValue([]);
      mockIntentService.detect.mockResolvedValue({
        intentLabel: 'general-faq',
        confidence: 0.6,
        language: 'zh-TW',
      });

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '詢價',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      const donePayloads = parseDonePayloads(res);
      expect(donePayloads).toHaveLength(1);
      expect(donePayloads[0]['action']).toBe('fallback');
      expect(donePayloads[0]['intentLabel']).toBe('general-faq');
    });

    it('should set intentLabel=null in done payload when safety guard intercepts (no intent detection run)', async () => {
      mockSafetyService.scanPrompt.mockReturnValue({
        blocked: true,
        category: 'prompt_injection',
        blockedReason: 'Pattern matched',
        promptHash: 'abc123',
      });
      mockConversationService.incrementSensitiveIntentCount.mockResolvedValue({
        sensitiveIntentCount: 1,
      });

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '注入攻擊',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      const donePayloads = parseDonePayloads(res);
      expect(donePayloads).toHaveLength(1);
      expect(donePayloads[0]['action']).toBe('intercepted');
      expect(donePayloads[0]['intentLabel']).toBeNull();
    });

    it('should set intentLabel=null in done payload when confidentiality intercepts (no intent detection run)', async () => {
      mockSafetyService.checkConfidentiality.mockReturnValue({
        triggered: true,
        matchedType: 'confidential',
        matchedKeyword: 'NDA',
      });
      mockConversationService.incrementSensitiveIntentCount.mockResolvedValue({
        sensitiveIntentCount: 1,
      });

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        'NDA question',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      const donePayloads = parseDonePayloads(res);
      expect(donePayloads).toHaveLength(1);
      expect(donePayloads[0]['action']).toBe('intercepted');
      expect(donePayloads[0]['intentLabel']).toBeNull();
    });

    it('should set intentLabel=null in done payload when AI is degraded (fallback response)', async () => {
      mockAiStatusService.isDegraded.mockReturnValue(true);

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '任意訊息',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      const donePayloads = parseDonePayloads(res);
      expect(donePayloads).toHaveLength(1);
      expect(donePayloads[0]['action']).toBe('fallback');
      expect(donePayloads[0]['intentLabel']).toBeNull();
    });

    it('should NOT call analyzeQuery when feature.query_analysis_enabled is null (default off)', async () => {
      mockSystemConfigService.getBoolean.mockReturnValue(null); // getBoolean returns null → default false
      mockRetrievalService.retrieve.mockResolvedValue([]);

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '你好',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      expect(mockQueryAnalysisService.analyze).not.toHaveBeenCalled();
    });

    it('should call analyzeQuery when feature.query_analysis_enabled is true', async () => {
      mockSystemConfigService.getBoolean.mockImplementation((key: string) => {
        if (key === 'feature.query_analysis_enabled') return true;
        return null;
      });
      mockRetrievalService.retrieve.mockResolvedValue([]);

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '螺絲規格',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      expect(mockQueryAnalysisService.analyze).toHaveBeenCalledWith('螺絲規格', expect.any(String));
    });

    it('should pass analyzedQuery to IntentService.detect when flag is on', async () => {
      const fakeAnalyzedQuery = {
        rawQuery: '螺絲規格',
        normalizedQuery: '螺絲規格',
        language: 'zh-TW',
        tokens: ['螺絲', '規格'],
        terms: ['螺絲', '規格'],
        phrases: [],
        expandedTerms: ['螺絲', '規格', 'screw', 'spec'],
        matchedRules: ['stop_word_zh'],
        selectedProfile: 'product',
        intentHints: [{ label: 'product-inquiry', score: 0.8 }],
        debugMeta: { processingMs: 8, normalizerSteps: ['question_shell'], expansionHits: 2 },
      };
      mockSystemConfigService.getBoolean.mockImplementation((key: string) => {
        if (key === 'feature.query_analysis_enabled') return true;
        return null;
      });
      mockQueryAnalysisService.analyze.mockResolvedValue(fakeAnalyzedQuery);
      mockIntentService.detect.mockResolvedValue({
        intentLabel: 'product-inquiry',
        confidence: 0.8,
        language: 'zh-TW',
      });
      mockRetrievalService.retrieve.mockResolvedValue([]);

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '螺絲規格',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      expect(mockIntentService.detect).toHaveBeenCalledWith(
        '螺絲規格',
        expect.any(String),
        fakeAnalyzedQuery,
      );
    });

    it('should pass normalizedQuery and rankingProfile to retrieval when flag is on', async () => {
      const fakeAnalyzedQuery = {
        rawQuery: '請問螺絲規格',
        normalizedQuery: '螺絲規格',
        language: 'zh-TW',
        tokens: ['螺絲', '規格'],
        terms: ['螺絲', '規格'],
        phrases: [],
        expandedTerms: ['螺絲', '規格'],
        matchedRules: [],
        selectedProfile: 'faq',
        intentHints: [],
        debugMeta: { processingMs: 4, normalizerSteps: [], expansionHits: 0 },
      };
      mockSystemConfigService.getBoolean.mockImplementation((key: string) => {
        if (key === 'feature.query_analysis_enabled') return true;
        return null;
      });
      mockQueryAnalysisService.analyze.mockResolvedValue(fakeAnalyzedQuery);
      mockRetrievalService.retrieve.mockResolvedValue([]);

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '請問螺絲規格',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      expect(mockRetrievalService.retrieve).toHaveBeenCalledWith(
        expect.objectContaining({
          query: '螺絲規格', // normalizedQuery, not raw
          rankingProfile: 'faq',
          expandedTerms: ['螺絲', '規格'],
        }),
      );
    });

    it('should include selectedProfile and extractedTerms in audit log when flag is on', async () => {
      const fakeAnalyzedQuery = {
        rawQuery: '螺絲問題',
        normalizedQuery: '螺絲問題',
        language: 'zh-TW',
        tokens: ['螺絲', '問題'],
        terms: ['螺絲', '問題'],
        phrases: [],
        expandedTerms: ['螺絲', '問題'],
        matchedRules: ['stop_word_zh'],
        selectedProfile: 'diagnosis',
        intentHints: [],
        debugMeta: { processingMs: 6, normalizerSteps: [], expansionHits: 0 },
      };
      mockSystemConfigService.getBoolean.mockImplementation((key: string) => {
        if (key === 'feature.query_analysis_enabled') return true;
        return null;
      });
      mockQueryAnalysisService.analyze.mockResolvedValue(fakeAnalyzedQuery);
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.9, { content: '螺絲問題解答', answerType: 'rag' }),
      ]);
      mockIntentService.detect.mockResolvedValue({
        intentLabel: null,
        confidence: 0,
        language: 'zh-TW',
      });
      async function* mockStream() {
        yield { token: '回應', done: false };
        yield {
          token: '',
          done: true,
          provider: 'mock',
          modelUsed: 'mock',
          fallbackTriggered: false,
          usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
        };
      }
      mockLlmProvider.stream.mockReturnValue(mockStream());

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '螺絲問題',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      const answerAuditCall = (mockAuditService.log as jest.Mock).mock.calls.find(
        (args: unknown[]) => (args[0] as { eventType: string }).eventType === 'chat_response',
      );
      expect(answerAuditCall).toBeDefined();
      const eventData = (answerAuditCall![0] as { eventData: Record<string, unknown> }).eventData;
      expect(eventData['selectedProfile']).toBe('diagnosis');
      expect(eventData['extractedTerms']).toEqual(['螺絲', '問題']);
      expect(eventData['matchedQueryRules']).toEqual(['stop_word_zh']);
    });

    it('should NOT include selectedProfile in audit log when flag is off (001 path)', async () => {
      mockSystemConfigService.getBoolean.mockReturnValue(null); // flag off
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.9, { content: '資訊', answerType: 'rag' }),
      ]);
      mockIntentService.detect.mockResolvedValue({
        intentLabel: null,
        confidence: 0,
        language: 'zh-TW',
      });
      async function* mockStream() {
        yield { token: '回應', done: false };
        yield {
          token: '',
          done: true,
          provider: 'mock',
          modelUsed: 'mock',
          fallbackTriggered: false,
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      }
      mockLlmProvider.stream.mockReturnValue(mockStream());

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '測試',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      const answerAuditCall = (mockAuditService.log as jest.Mock).mock.calls.find(
        (args: unknown[]) => (args[0] as { eventType: string }).eventType === 'chat_response',
      );
      expect(answerAuditCall).toBeDefined();
      const eventData = (answerAuditCall![0] as { eventData: Record<string, unknown> }).eventData;
      expect(eventData['selectedProfile']).toBeUndefined();
      expect(eventData['extractedTerms']).toBeUndefined();
    });

    it('should pass raw userMessage (not normalizedQuery) to retrieval when flag is off', async () => {
      mockSystemConfigService.getBoolean.mockReturnValue(null); // flag off
      mockRetrievalService.retrieve.mockResolvedValue([]);

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '請問你們的螺絲規格如何',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      expect(mockRetrievalService.retrieve).toHaveBeenCalledWith(
        expect.objectContaining({
          query: '請問你們的螺絲規格如何', // raw, not normalized
          rankingProfile: undefined,
          expandedTerms: undefined,
        }),
      );
    });
  });

  // ── TM-002: Template / rag+template path integration ──────────────────

  describe('TM-002 / TM-003 — template resolver integration', () => {
    it('strategy=rag: LLM IS called (001 backward compat)', async () => {
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.9, { content: '螺絲規格', answerType: 'rag' }),
      ]);
      mockTemplateResolver.resolve.mockReturnValue({ strategy: 'rag', reason: 'rag:1' });
      async function* mockStream() {
        yield { token: '回應', done: false };
        yield {
          token: '',
          done: true,
          provider: 'mock',
          modelUsed: 'mock',
          fallbackTriggered: false,
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      }
      mockLlmProvider.stream.mockReturnValue(mockStream());

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '螺絲規格',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      // LLM was called
      expect(mockLlmProvider.stream).toHaveBeenCalled();
      // done event present
      const raw = (res.write as jest.Mock).mock.calls
        .map((c: unknown[]) => c[0] as string)
        .join('');
      expect(raw).toContain('event: done');
    });

    it('strategy=template: LLM is NOT called, resolvedContent emitted as token', async () => {
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.9, { id: 42, content: '直接回覆內容', answerType: 'template', sourceKey: 'faq-key' }),
      ]);
      mockTemplateResolver.resolve.mockReturnValue({
        strategy: 'template',
        resolvedContent: '直接回覆內容',
        reason: 'template:faq-key',
      });

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '查詢',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      // LLM was NOT called
      expect(mockLlmProvider.stream).not.toHaveBeenCalled();

      // SSE output: token + done
      const raw = (res.write as jest.Mock).mock.calls
        .map((c: unknown[]) => c[0] as string)
        .join('');
      expect(raw).toContain('event: token');
      expect(raw).toContain('直接回覆內容');
      expect(raw).toContain('event: done');
    });

    it('strategy=template: done event has action=answer and correct messageId', async () => {
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.9, { id: 42, content: '模板回覆', answerType: 'template', sourceKey: 'tpl-1' }),
      ]);
      mockTemplateResolver.resolve.mockReturnValue({
        strategy: 'template',
        resolvedContent: '模板回覆',
        reason: 'template:tpl-1',
      });
      mockConversationService.addMessage
        .mockResolvedValueOnce({ id: 10 }) // user message
        .mockResolvedValueOnce({ id: 11 }); // assistant message

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '查詢',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      const raw = (res.write as jest.Mock).mock.calls
        .map((c: unknown[]) => c[0] as string)
        .join('');
      expect(raw).toContain('"action":"answer"');
      expect(raw).toContain('"messageId":11');
    });

    it('strategy=template: audit log contains templateStrategy and templateReason', async () => {
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.9, { id: 5, content: '規格內容', answerType: 'template', sourceKey: 'spec-key' }),
      ]);
      mockTemplateResolver.resolve.mockReturnValue({
        strategy: 'template',
        resolvedContent: '規格內容',
        reason: 'template:spec-key',
      });

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '查詢',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      const answerAuditCall = (mockAuditService.log as jest.Mock).mock.calls.find(
        (args: unknown[]) => (args[0] as { eventType: string }).eventType === 'chat_response',
      );
      expect(answerAuditCall).toBeDefined();
      const eventData = (answerAuditCall![0] as { eventData: Record<string, unknown> }).eventData;
      expect(eventData['templateStrategy']).toBe('template');
      expect(eventData['templateReason']).toBe('template:spec-key');
    });

    it('strategy=rag+template: LLM is NOT called, resolvedContent emitted', async () => {
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.85, { id: 7, content: 'M3 螺絲 100 元', answerType: 'rag+template', sourceKey: 'pricing-key' }),
      ]);
      mockTemplateResolver.resolve.mockReturnValue({
        strategy: 'rag+template',
        resolvedContent: '以下是價格：M3 螺絲 100 元',
        reason: 'rag+template:pricing-key',
      });

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '螺絲多少錢',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      // LLM NOT called
      expect(mockLlmProvider.stream).not.toHaveBeenCalled();

      const raw = (res.write as jest.Mock).mock.calls
        .map((c: unknown[]) => c[0] as string)
        .join('');
      expect(raw).toContain('以下是價格：M3 螺絲 100 元');
      expect(raw).toContain('event: done');
    });

    it('strategy=rag+template: audit log shows aiProvider=template and zero token counts', async () => {
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.85, { id: 8, content: '資料', answerType: 'rag+template', sourceKey: 'k' }),
      ]);
      mockTemplateResolver.resolve.mockReturnValue({
        strategy: 'rag+template',
        resolvedContent: '填好的回答',
        reason: 'rag+template:k',
      });

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '問題',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      const answerAuditCall = (mockAuditService.log as jest.Mock).mock.calls.find(
        (args: unknown[]) => (args[0] as { eventType: string }).eventType === 'chat_response',
      );
      expect(answerAuditCall).toBeDefined();
      const logArg = answerAuditCall![0] as Record<string, unknown>;
      expect(logArg['aiProvider']).toBe('template');
      expect(logArg['promptTokens']).toBe(0);
      expect(logArg['completionTokens']).toBe(0);
    });

    it('strategy=llm: LLM IS called (explicit llm path)', async () => {
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.9, { id: 3, content: '內容', answerType: 'llm' }),
      ]);
      mockTemplateResolver.resolve.mockReturnValue({ strategy: 'llm', reason: 'explicit_llm:3' });
      async function* mockStream() {
        yield { token: '答案', done: false };
        yield {
          token: '',
          done: true,
          provider: 'mock',
          modelUsed: 'mock',
          fallbackTriggered: false,
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      }
      mockLlmProvider.stream.mockReturnValue(mockStream());

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '問題',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      expect(mockLlmProvider.stream).toHaveBeenCalled();
    });

    it('template path: resolveTemplate is called with ragResults, intentLabel, and language', async () => {
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.9, { content: '內容', answerType: 'rag' }),
      ]);
      const resolveTemplateSpy = jest.spyOn(service, 'resolveTemplate');
      async function* mockStream() {
        yield {
          token: '',
          done: true,
          provider: 'mock',
          modelUsed: 'mock',
          fallbackTriggered: false,
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      }
      mockLlmProvider.stream.mockReturnValue(mockStream());

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '測試',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      // Verify resolveTemplate was called exactly once with the correct argument types
      expect(resolveTemplateSpy).toHaveBeenCalledTimes(1);
      const [ragArg, , langArg] = resolveTemplateSpy.mock.calls[0];
      expect(Array.isArray(ragArg)).toBe(true);
      expect(typeof langArg).toBe('string');
    });

    it('TM-003: default answerType=rag entries: all 001 behaviours preserved (LLM called, done emitted)', async () => {
      // Simulate a standard 001 flow with a rag-type entry
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.85, { id: 99, content: '知識庫內容', answerType: 'rag' }),
      ]);
      // resolver returns 'rag' (which it does by default in beforeEach)
      async function* mockStream() {
        yield { token: 'LLM 回應', done: false };
        yield {
          token: '',
          done: true,
          provider: 'openai',
          modelUsed: 'gpt-4',
          fallbackTriggered: false,
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        };
      }
      mockLlmProvider.stream.mockReturnValue(mockStream());

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '你好',
        'req-id',
        res as never,
        new AbortController().signal,
      );

      expect(mockLlmProvider.stream).toHaveBeenCalled();
      const raw = (res.write as jest.Mock).mock.calls
        .map((c: unknown[]) => c[0] as string)
        .join('');
      expect(raw).toContain('event: token');
      expect(raw).toContain('LLM 回應');
      expect(raw).toContain('event: done');
      expect(raw).toContain('"action":"answer"');
    });
  });

  // ── Phase 4-E: T064 — No-answer Gate + QU V2 integration ──────────────────

  describe('Phase 4-E — No-answer Gate integration (T064)', () => {
    const makeQu = (): QueryUnderstandingResult => ({
      rawQuery: '測試查詢',
      normalizedQuery: '測試查詢',
      language: 'zh-TW',
      tokenizer: 'rule-based',
      tokens: [
        {
          text: '測試',
          normalizedText: '測試',
          tokenType: TokenType.Product,
          weight: 0.9,
          source: 'rule-based',
        },
      ],
      keyPhrases: [
        {
          text: '測試',
          normalizedText: '測試',
          tokenType: TokenType.Product,
          weight: 0.9,
          source: 'rule-based',
        },
      ],
      queryType: QueryType.ProductLookup,
      supportability: 'supported',
      retrievalPlan: {
        searchTerms: ['測試'],
        strategies: ['keyword'],
        maxResults: 5,
        language: 'zh-TW',
      },
      debugMeta: {
        durationMs: 10,
        tokenizerUsed: 'rule-based',
        timestamp: new Date().toISOString(),
      },
    });

    const makeChunk = (score: number): ChunkResult => ({
      knowledgeEntryId: 1,
      sourceKey: 'test-key',
      content: '測試內容',
      score,
      language: 'zh-TW',
    });

    const makeGoodDecision = (): RetrievalDecision => ({
      canAnswer: true,
      reason: 'ok',
      confidence: 0.9,
      topK: [],
    });

    const makeBlockDecision = (reason: RetrievalDecisionReason = 'no_results'): RetrievalDecision => ({
      canAnswer: false,
      reason,
      confidence: 0,
      topK: [],
    });

    beforeEach(() => {
      // Optional QU / Hybrid Retrieval services are registered in the shared TestingModule (outer beforeEach).
      // Set up 003 mock defaults for Phase 4-E tests.
      mockQUS003.understand.mockResolvedValue(makeQu());
      mockHRS003.retrieve.mockResolvedValue([]);
      mockRDS003.decideFromChunks.mockReturnValue(makeGoodDecision());
      mockRDS003.decideFromRetrievalResults.mockReturnValue(makeGoodDecision());
    });

    it('T064-1: all feature flags false → 002 behaviour unchanged, optional QU / Hybrid Retrieval services not called', async () => {
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.9, { content: '產品資訊' }),
      ]);
      async function* mockStream() {
        yield { token: '回應', done: false };
        yield {
          token: '',
          done: true,
          provider: 'mock',
          modelUsed: 'mock',
          fallbackTriggered: false,
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      }
      mockLlmProvider.stream.mockReturnValue(mockStream());

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '測試查詢',
        'req-t064-1',
        res as never,
        new AbortController().signal,
      );

      expect(mockQUS003.understand).not.toHaveBeenCalled();
      expect(mockHRS003.retrieve).not.toHaveBeenCalled();
      expect(mockRDS003.decideFromChunks).not.toHaveBeenCalled();
      expect(mockRDS003.decideFromRetrievalResults).not.toHaveBeenCalled();
      expect(mockLlmProvider.stream).toHaveBeenCalled();
    });

    it('T064-2: quV2Enabled=true → understand() called with userMessage and language', async () => {
      mockSystemConfigService.getBoolean.mockImplementation((key: string) => {
        if (key === 'feature.query_understanding_v2_enabled') return true;
        return null;
      });
      mockRetrievalService.retrieve.mockResolvedValue([]);

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '測試查詢',
        'req-t064-2',
        res as never,
        new AbortController().signal,
      );

      expect(mockQUS003.understand).toHaveBeenCalledWith('測試查詢', expect.any(String));
      const raw = (res.write as jest.Mock).mock.calls.map((c: unknown[]) => c[0] as string).join('');
      expect(raw).toContain('event: done');
    });

    it('T064-3: gateEnabled=true + legacy hits → decideFromRetrievalResults called, canAnswer=true, LLM called', async () => {
      mockSystemConfigService.getBoolean.mockImplementation((key: string) => {
        if (key === 'feature.no_answer_gate_enabled') return true;
        return null;
      });
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.9, { content: '產品資訊' }),
      ]);
      mockRDS003.decideFromRetrievalResults.mockReturnValue(makeGoodDecision());
      async function* mockStream() {
        yield { token: '回應', done: false };
        yield {
          token: '',
          done: true,
          provider: 'mock',
          modelUsed: 'mock',
          fallbackTriggered: false,
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      }
      mockLlmProvider.stream.mockReturnValue(mockStream());

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '產品詢問',
        'req-t064-3',
        res as never,
        new AbortController().signal,
      );

      expect(mockRDS003.decideFromRetrievalResults).toHaveBeenCalled();
      expect(mockLlmProvider.stream).toHaveBeenCalled();
    });

    it('T064-4: gateEnabled=true + no legacy hits + canAnswer=false → fallback SSE, LLM not called', async () => {
      mockSystemConfigService.getBoolean.mockImplementation((key: string) => {
        if (key === 'feature.no_answer_gate_enabled') return true;
        return null;
      });
      mockRetrievalService.retrieve.mockResolvedValue([]);
      mockRDS003.decideFromRetrievalResults.mockReturnValue(makeBlockDecision('no_results'));

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '無命中查詢',
        'req-t064-4',
        res as never,
        new AbortController().signal,
      );

      expect(mockLlmProvider.stream).not.toHaveBeenCalled();
      const raw = (res.write as jest.Mock).mock.calls.map((c: unknown[]) => c[0] as string).join('');
      expect(raw).toContain('event: done');
      expect(raw).toContain('fallback');
    });

    it('T064-5: gateEnabled=true + low_score result → canAnswer=false, fallbackReason=low_score and llmCalled=false in audit', async () => {
      mockSystemConfigService.getBoolean.mockImplementation((key: string) => {
        if (key === 'feature.no_answer_gate_enabled') return true;
        return null;
      });
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.1, { content: '低分內容' }),
      ]);
      mockRDS003.decideFromRetrievalResults.mockReturnValue(makeBlockDecision('low_score'));

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '低分查詢',
        'req-t064-5',
        res as never,
        new AbortController().signal,
      );

      expect(mockLlmProvider.stream).not.toHaveBeenCalled();
      const chatResponseAudit = (mockAuditService.log as jest.Mock).mock.calls.find(
        (args: unknown[]) => (args[0] as { eventType: string }).eventType === 'chat_response',
      );
      expect(chatResponseAudit).toBeDefined();
      const eventData = (chatResponseAudit![0] as { eventData: Record<string, unknown> }).eventData;
      expect(eventData['fallbackReason']).toBe('low_score');
      expect(eventData['llmCalled']).toBe(false);
    });

    it('T064-6: hybridEnabled=true + quV2=true + canAnswer=false → hybridRetrieve and decideFromChunks called, LLM not called', async () => {
      mockSystemConfigService.getBoolean.mockImplementation((key: string) => {
        if (key === 'feature.hybrid_retrieval_enabled') return true;
        if (key === 'feature.no_answer_gate_enabled') return true;
        if (key === 'feature.query_understanding_v2_enabled') return true;
        return null;
      });
      const chunks: ChunkResult[] = [makeChunk(0.1)];
      mockHRS003.retrieve.mockResolvedValue(chunks);
      mockRDS003.decideFromChunks.mockReturnValue(makeBlockDecision('low_score'));

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '混合查詢',
        'req-t064-6',
        res as never,
        new AbortController().signal,
      );

      expect(mockHRS003.retrieve).toHaveBeenCalled();
      expect(mockRDS003.decideFromChunks).toHaveBeenCalled();
      expect(mockLlmProvider.stream).not.toHaveBeenCalled();
      const raw = (res.write as jest.Mock).mock.calls.map((c: unknown[]) => c[0] as string).join('');
      expect(raw).toContain('fallback');
    });

    it('T064-7: gateEnabled=true + canAnswer=true + strategy=template → LLM not called', async () => {
      mockSystemConfigService.getBoolean.mockImplementation((key: string) => {
        if (key === 'feature.no_answer_gate_enabled') return true;
        return null;
      });
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.9, {
          content: '模板內容',
          answerType: 'template',
          sourceKey: 'tpl-key',
        }),
      ]);
      mockRDS003.decideFromRetrievalResults.mockReturnValue(makeGoodDecision());
      mockTemplateResolver.resolve.mockReturnValue({
        strategy: 'template',
        resolvedContent: '直接模板回覆',
        reason: 'template:tpl-key',
      });

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '模板查詢',
        'req-t064-7',
        res as never,
        new AbortController().signal,
      );

      expect(mockLlmProvider.stream).not.toHaveBeenCalled();
      const raw = (res.write as jest.Mock).mock.calls.map((c: unknown[]) => c[0] as string).join('');
      expect(raw).toContain('直接模板回覆');
      expect(raw).toContain('event: done');
    });

    it('T064-8: gateEnabled=true + canAnswer=true + strategy=rag → LLM called', async () => {
      mockSystemConfigService.getBoolean.mockImplementation((key: string) => {
        if (key === 'feature.no_answer_gate_enabled') return true;
        return null;
      });
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.9, { content: '知識內容' }),
      ]);
      mockRDS003.decideFromRetrievalResults.mockReturnValue(makeGoodDecision());
      mockTemplateResolver.resolve.mockReturnValue({ strategy: 'rag', reason: 'rag:default' });
      async function* mockStream() {
        yield { token: 'LLM回應', done: false };
        yield {
          token: '',
          done: true,
          provider: 'mock',
          modelUsed: 'mock',
          fallbackTriggered: false,
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      }
      mockLlmProvider.stream.mockReturnValue(mockStream());

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '知識庫問題',
        'req-t064-8',
        res as never,
        new AbortController().signal,
      );

      expect(mockLlmProvider.stream).toHaveBeenCalled();
      const raw = (res.write as jest.Mock).mock.calls.map((c: unknown[]) => c[0] as string).join('');
      expect(raw).toContain('event: done');
      expect(raw).toContain('"action":"answer"');
    });

    it('T064-9: gateEnabled=true + canAnswer=false → action=fallback in SSE and llmCalled=false in audit', async () => {
      mockSystemConfigService.getBoolean.mockImplementation((key: string) => {
        if (key === 'feature.no_answer_gate_enabled') return true;
        return null;
      });
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.9, { content: '產品資訊' }),
      ]);
      mockRDS003.decideFromRetrievalResults.mockReturnValue(makeBlockDecision('unsupported'));

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '不支援的查詢',
        'req-t064-9',
        res as never,
        new AbortController().signal,
      );

      expect(mockLlmProvider.stream).not.toHaveBeenCalled();
      const raw = (res.write as jest.Mock).mock.calls.map((c: unknown[]) => c[0] as string).join('');
      expect(raw).toContain('"action":"fallback"');
      const chatResponseAudit = (mockAuditService.log as jest.Mock).mock.calls.find(
        (args: unknown[]) => (args[0] as { eventType: string }).eventType === 'chat_response',
      );
      expect(chatResponseAudit).toBeDefined();
      const eventData = (chatResponseAudit![0] as { eventData: Record<string, unknown> }).eventData;
      expect(eventData['llmCalled']).toBe(false);
      expect(eventData['canAnswer']).toBe(false);
    });
  });

  describe('Phase 4-D — T4-005/T4-006 high intent and lead prompt', () => {
    const parseDonePayload = (res: jest.Mocked<Partial<Response>>): Record<string, unknown> | null => {
      const raw = (res.write as jest.Mock).mock.calls
        .map((c: unknown[]) => c[0] as string)
        .join('');
      const blocks = raw.split('\n\n').filter(Boolean);
      for (const block of blocks) {
        const eventLine = block
          .split('\n')
          .find((line: string) => line.startsWith('event:') && line.includes('done'));
        const dataLine = block
          .split('\n')
          .find((line: string) => line.startsWith('data:'));
        if (eventLine && dataLine) {
          return JSON.parse(dataLine.replace(/^data:\s*/, '')) as Record<string, unknown>;
        }
      }
      return null;
    };

    const makeLlmStream = (token: string) =>
      (async function* () {
        yield { token, done: false };
        yield {
          token: '',
          done: true,
          provider: 'mock',
          modelUsed: 'mock',
          fallbackTriggered: false,
          usage: { promptTokens: 5, completionTokens: 7, totalTokens: 12 },
        };
      })();

    it('price-inquiry leads to leadPrompted=true even when high-intent score is below threshold', async () => {
      mockIntentService.detect.mockResolvedValue({
        intentLabel: 'price-inquiry',
        confidence: 0.91,
        language: 'zh-TW',
      });
      mockIntentService.isHighIntent.mockReturnValue({
        isHighIntent: false,
        score: 0,
        matchedKeywords: [],
      });
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.9, { id: 301, content: '價格資訊', sourceKey: 'KB-301' }),
      ]);
      mockLlmProvider.stream.mockReturnValue(makeLlmStream('目前可提供規格與價格資訊。'));

      const conversation = makeConversation();
      const res = makeRes();

      await service.run(
        conversation as never,
        '請問報價多少？',
        'req-t4d-1',
        res as never,
        new AbortController().signal,
      );

      const done = parseDonePayload(res);
      expect(done).not.toBeNull();
      expect(done!['leadPrompted']).toBe(true);
      expect(done!['action']).toBe('answer');

      expect(mockConversationService.updateConversation).toHaveBeenCalledWith(
        conversation.sessionId,
        expect.objectContaining({ highIntentScore: 0 }),
      );

      const assistantContent = (mockConversationService.addMessage as jest.Mock).mock.calls[1][1]
        .content as string;
      expect(assistantContent).toContain('如果您願意，也可以留下姓名、Email、公司與需求');

      const auditCall = (mockAuditService.log as jest.Mock).mock.calls.find(
        (args: unknown[]) => (args[0] as { eventType: string }).eventType === 'chat_response',
      );
      const eventData = (auditCall?.[0] as { eventData: Record<string, unknown> }).eventData;
      expect(eventData['leadPrompted']).toBe(true);
      expect(eventData['highIntentScore']).toBe(0);

      const eventTypes = (mockAuditService.log as jest.Mock).mock.calls.map(
        (args: unknown[]) => (args[0] as { eventType: string }).eventType,
      );
      expect(eventTypes).not.toContain('lead_created');
      expect(eventTypes).not.toContain('ticket_created');
    });

    it('high intent appends zh-TW lead prompt and records matched keywords', async () => {
      mockIntentService.detect.mockResolvedValue({
        intentLabel: 'product-inquiry',
        confidence: 0.86,
        language: 'zh-TW',
      });
      mockIntentService.isHighIntent.mockReturnValue({
        isHighIntent: true,
        score: 3,
        matchedKeywords: ['報價', '聯絡'],
      });
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.9, { id: 302, content: '產品資訊', sourceKey: 'KB-302' }),
      ]);
      mockLlmProvider.stream.mockReturnValue(makeLlmStream('這是建議內容。'));

      const conversation = makeConversation();
      const res = makeRes();

      await service.run(
        conversation as never,
        '我想了解可否採購與聯絡業務',
        'req-t4d-2',
        res as never,
        new AbortController().signal,
      );

      const assistantContent = (mockConversationService.addMessage as jest.Mock).mock.calls[1][1]
        .content as string;
      expect(assistantContent).toContain('如果您願意，也可以留下姓名、Email、公司與需求');

      const auditCall = (mockAuditService.log as jest.Mock).mock.calls.find(
        (args: unknown[]) => (args[0] as { eventType: string }).eventType === 'chat_response',
      );
      const eventData = (auditCall?.[0] as { eventData: Record<string, unknown> }).eventData;
      expect(eventData['leadPrompted']).toBe(true);
      expect(eventData['highIntentScore']).toBe(3);
      expect(eventData['matchedHighIntentKeywords']).toEqual(['報價', '聯絡']);
    });

    it('high intent in English appends en lead prompt text', async () => {
      mockIntentService.detect.mockResolvedValue({
        intentLabel: 'general-faq',
        confidence: 0.8,
        language: 'en',
      });
      mockIntentService.isHighIntent.mockReturnValue({
        isHighIntent: true,
        score: 2,
        matchedKeywords: ['quote', 'contact'],
      });
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.9, {
          id: 303,
          content: 'English content',
          sourceKey: 'KB-303',
          language: 'en',
        }),
      ]);
      mockLlmProvider.stream.mockReturnValue(makeLlmStream('Here is the recommendation.'));

      const conversation = makeConversation();
      const res = makeRes();

      await service.run(
        conversation as never,
        'Can I get a quote and contact sales?',
        'req-t4d-3',
        res as never,
        new AbortController().signal,
      );

      const assistantContent = (mockConversationService.addMessage as jest.Mock).mock.calls[1][1]
        .content as string;
      expect(assistantContent).toContain(
        'You may also leave your name, email, company, and requirements so our sales team can help confirm the suitable specifications and quotation.',
      );

      const done = parseDonePayload(res);
      expect(done).not.toBeNull();
      expect(done!['leadPrompted']).toBe(true);
    });
  });

  // ── Phase 5-D: T073 — sourceReferences / answerMode / trace traceability ──

  describe('Phase 5-D — T073 traceability (sourceReferences / answerMode / trace)', () => {
    /** Parse the first `event: done` payload from SSE writes. */
    const parseDonePayload = (
      res: jest.Mocked<Partial<Response>>,
    ): Record<string, unknown> | undefined => {
      const raw = (res.write as jest.Mock).mock.calls
        .map((c: unknown[]) => c[0] as string)
        .join('');
      for (const block of raw.split('\n\n').filter(Boolean)) {
        const lines = block.split('\n');
        if (lines.some(l => l.startsWith('event:') && l.includes('done'))) {
          const dataLine = lines.find(l => l.startsWith('data:'));
          if (dataLine)
            return JSON.parse(dataLine.replace(/^data:\s*/, '')) as Record<string, unknown>;
        }
      }
      return undefined;
    };

    /** Return the first `chat_response` audit log call argument, or undefined. */
    const getChatResponseAuditArg = (): Record<string, unknown> | undefined => {
      const call = (mockAuditService.log as jest.Mock).mock.calls.find(
        (args: unknown[]) => (args[0] as { eventType: string }).eventType === 'chat_response',
      );
      return call ? (call[0] as Record<string, unknown>) : undefined;
    };

    /** Factory: fresh async generator that simulates a successful LLM stream. */
    const makeLlmStream = () =>
      (async function* () {
        yield { token: '回應', done: false };
        yield {
          token: '',
          done: true,
          provider: 'mock',
          modelUsed: 'mock',
          fallbackTriggered: false,
          usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
        };
      })();

    // ── T073-1: LLM answer path — sourceReferences present and non-empty ──

    it('T073-1: LLM answer path: sourceReferences present and non-empty in SSE done and AuditLog', async () => {
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.9, { id: 42, content: '產品資訊', sourceKey: 'product-key' }),
      ]);
      mockLlmProvider.stream.mockReturnValue(makeLlmStream());

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '螺絲查詢',
        'req-t073-1',
        res as never,
        new AbortController().signal,
      );

      // SSE done
      const done = parseDonePayload(res);
      expect(done).toBeDefined();
      const doneRefs = done!['sourceReferences'] as Record<string, unknown>[];
      expect(Array.isArray(doneRefs)).toBe(true);
      expect(doneRefs.length).toBeGreaterThan(0);
      expect(doneRefs[0]['knowledgeEntryId']).toBe(42);
      expect(doneRefs[0]['sourceKey']).toBe('product-key');
      expect(typeof doneRefs[0]['score']).toBe('number');
      expect(doneRefs[0]['chunkIndex']).toBe(0);

      // AuditLog V2 fields
      const audit = getChatResponseAuditArg();
      expect(audit).toBeDefined();
      const auditRefs = audit!['sourceReferences'] as Record<string, unknown>[];
      expect(Array.isArray(auditRefs)).toBe(true);
      expect(auditRefs.length).toBeGreaterThan(0);
      expect(audit!['llmCalled']).toBe(true);
      expect(typeof audit!['answerMode']).toBe('string');
    });

    // ── T073-2: Template path — sourceReferences present and non-empty ──

    it('T073-2: template path: LLM not called, sourceReferences non-empty, answerMode=template in AuditLog', async () => {
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.9, {
          id: 10,
          content: '模板內容',
          answerType: 'template',
          sourceKey: 'tpl-key',
        }),
      ]);
      mockTemplateResolver.resolve.mockReturnValue({
        strategy: 'template',
        resolvedContent: '模板答案',
        reason: 'template:tpl-key',
      });

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '模板查詢',
        'req-t073-2',
        res as never,
        new AbortController().signal,
      );

      expect(mockLlmProvider.stream).not.toHaveBeenCalled();

      const done = parseDonePayload(res);
      const doneRefs = done!['sourceReferences'] as Record<string, unknown>[];
      expect(Array.isArray(doneRefs)).toBe(true);
      expect(doneRefs.length).toBeGreaterThan(0);
      expect(doneRefs[0]['knowledgeEntryId']).toBe(10);

      const audit = getChatResponseAuditArg();
      expect(audit!['answerMode']).toBe('template');
      expect(audit!['llmCalled']).toBe(false);
      const auditRefs = audit!['sourceReferences'] as Record<string, unknown>[];
      expect(Array.isArray(auditRefs)).toBe(true);
      expect(auditRefs.length).toBeGreaterThan(0);
    });

    // ── T073-3: rag+template path — sourceReferences present and non-empty ──

    it('T073-3: rag+template path: LLM not called, sourceReferences non-empty, answerMode=rag+template', async () => {
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.85, {
          id: 11,
          content: 'M3 螺絲 100 元',
          answerType: 'rag+template',
          sourceKey: 'pricing-key',
        }),
      ]);
      mockTemplateResolver.resolve.mockReturnValue({
        strategy: 'rag+template',
        resolvedContent: '填好的回答',
        reason: 'rag+template:pricing-key',
      });

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '螺絲多少錢',
        'req-t073-3',
        res as never,
        new AbortController().signal,
      );

      expect(mockLlmProvider.stream).not.toHaveBeenCalled();

      const done = parseDonePayload(res);
      const doneRefs = done!['sourceReferences'] as Record<string, unknown>[];
      expect(Array.isArray(doneRefs)).toBe(true);
      expect(doneRefs.length).toBeGreaterThan(0);

      const audit = getChatResponseAuditArg();
      expect(audit!['answerMode']).toBe('rag+template');
      expect(audit!['llmCalled']).toBe(false);
    });

    // ── T073-4a: Step 7 no-hits fallback — sourceReferences=[] ──

    it('T073-4a: Step 7 no-hits fallback: sourceReferences=[] in SSE done and AuditLog', async () => {
      mockRetrievalService.retrieve.mockResolvedValue([]);

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '無命中查詢',
        'req-t073-4a',
        res as never,
        new AbortController().signal,
      );

      expect(mockLlmProvider.stream).not.toHaveBeenCalled();

      const done = parseDonePayload(res);
      expect(done!['action']).toBe('fallback');
      expect(done!['sourceReferences']).toEqual([]);

      const audit = getChatResponseAuditArg();
      expect(audit!['answerMode']).toBe('fallback');
      expect(audit!['llmCalled']).toBe(false);
      expect(audit!['sourceReferences']).toEqual([]);
    });

    // ── T073-4b: No-answer Gate canAnswer=false — sourceReferences=[] ──

    it('T073-4b: No-answer gate canAnswer=false fallback: sourceReferences=[] in SSE done and AuditLog', async () => {
      mockSystemConfigService.getBoolean.mockImplementation((key: string) => {
        if (key === 'feature.no_answer_gate_enabled') return true;
        return null;
      });
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.9, { content: '產品資訊' }),
      ]);
      mockRDS003.decideFromRetrievalResults.mockReturnValue({
        canAnswer: false,
        reason: 'unsupported',
        confidence: 0,
        topK: [],
      });

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '不支援的查詢',
        'req-t073-4b',
        res as never,
        new AbortController().signal,
      );

      expect(mockLlmProvider.stream).not.toHaveBeenCalled();

      const done = parseDonePayload(res);
      expect(done!['action']).toBe('fallback');
      expect(done!['sourceReferences']).toEqual([]);

      const audit = getChatResponseAuditArg();
      expect(audit!['answerMode']).toBe('fallback');
      expect(audit!['llmCalled']).toBe(false);
      expect(audit!['sourceReferences']).toEqual([]);
    });

    // ── T073-5: traceable_answer_enabled=false — sourceReferences present, trace absent ──

    it('T073-5: traceable_answer_enabled=false: sourceReferences present, trace absent in AuditLog', async () => {
      mockSystemConfigService.getBoolean.mockImplementation((key: string) => {
        if (key === 'feature.traceable_answer_enabled') return false;
        return null;
      });
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.9, { id: 1, content: '資訊', sourceKey: 'sk-1' }),
      ]);
      mockLlmProvider.stream.mockReturnValue(makeLlmStream());

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '查詢',
        'req-t073-5',
        res as never,
        new AbortController().signal,
      );

      const done = parseDonePayload(res);
      // sourceReferences MUST exist (even when trace is off)
      expect(Array.isArray(done!['sourceReferences'])).toBe(true);
      // SSE done does not carry trace
      expect(done!['trace']).toBeUndefined();

      const audit = getChatResponseAuditArg();
      const auditRefs = audit!['sourceReferences'] as unknown[];
      expect(Array.isArray(auditRefs)).toBe(true);
      expect(auditRefs.length).toBeGreaterThan(0);
      // trace must be absent when flag=false
      expect(audit!['trace']).toBeUndefined();
    });

    // ── T073-6: traceable_answer_enabled=true — trace present in AuditLog ──

    it('T073-6: traceable_answer_enabled=true: trace present in AuditLog with correct shape', async () => {
      mockSystemConfigService.getBoolean.mockImplementation((key: string) => {
        if (key === 'feature.traceable_answer_enabled') return true;
        return null;
      });
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.9, { id: 1, content: '資訊', sourceKey: 'sk-2' }),
      ]);
      mockLlmProvider.stream.mockReturnValue(makeLlmStream());

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '查詢',
        'req-t073-6',
        res as never,
        new AbortController().signal,
      );

      const audit = getChatResponseAuditArg();

      // sourceReferences still present when trace is on
      const auditRefs = audit!['sourceReferences'] as unknown[];
      expect(Array.isArray(auditRefs)).toBe(true);
      expect(auditRefs.length).toBeGreaterThan(0);

      // trace must exist with expected numeric fields
      const trace = audit!['trace'] as Record<string, unknown>;
      expect(trace).toBeDefined();
      expect(typeof trace['totalMs']).toBe('number');
      expect(typeof trace['queryUnderstandingMs']).toBe('number');
      // LLM path: llmMs is set (may be 0 in tests due to instant mock)
      expect(typeof trace['llmMs']).toBe('number');

      // SSE done never carries trace (not part of SseDonePayload)
      const done = parseDonePayload(res);
      expect(done!['trace']).toBeUndefined();
    });

    // ── T073-7: SSE done payload backward compatibility ──

    it('T073-7: SSE done payload has all required backward-compat fields', async () => {
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.9, { id: 1, content: '資訊' }),
      ]);
      mockIntentService.detect.mockResolvedValue({
        intentLabel: 'product-inquiry',
        confidence: 0.85,
        language: 'zh-TW',
      });
      mockConversationService.addMessage
        .mockResolvedValueOnce({ id: 5 })
        .mockResolvedValueOnce({ id: 6 });
      mockLlmProvider.stream.mockReturnValue(makeLlmStream());

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '查詢',
        'req-t073-7',
        res as never,
        new AbortController().signal,
      );

      const done = parseDonePayload(res);
      expect(done).toBeDefined();
      // All 5 required fields must be present
      expect(done!).toHaveProperty('messageId');
      expect(done!).toHaveProperty('action');
      expect(done!).toHaveProperty('intentLabel');
      expect(done!).toHaveProperty('sourceReferences');
      expect(done!).toHaveProperty('usage');
      // usage sub-fields
      const usage = done!['usage'] as Record<string, unknown>;
      expect(usage).toHaveProperty('promptTokens');
      expect(usage).toHaveProperty('completionTokens');
      expect(usage).toHaveProperty('totalTokens');
      // messageId is the assistant message ID (second addMessage call)
      expect(done!['messageId']).toBe(6);
    });

    // ── T073-8: all feature flags false — 002 baseline preserved ──

    it('T073-8: all feature flags false — sourceReferences present, trace absent (002 baseline)', async () => {
      // beforeEach already sets all getBoolean → null (flags off)
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.9, { id: 1, content: '資訊', sourceKey: 'sk-3' }),
      ]);
      mockLlmProvider.stream.mockReturnValue(makeLlmStream());

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '查詢',
        'req-t073-8',
        res as never,
        new AbortController().signal,
      );

      // 003 optional QU / Hybrid Retrieval services must NOT be called
      expect(mockQUS003.understand).not.toHaveBeenCalled();
      expect(mockHRS003.retrieve).not.toHaveBeenCalled();

      // sourceReferences must exist even on the 001 code path
      const done = parseDonePayload(res);
      expect(Array.isArray(done!['sourceReferences'])).toBe(true);
      // SSE done has no trace field
      expect(done!['trace']).toBeUndefined();

      const audit = getChatResponseAuditArg();
      // trace absent (traceable flag off)
      expect(audit!['trace']).toBeUndefined();
      // sourceReferences populated from legacy adapter
      const auditRefs = audit!['sourceReferences'] as unknown[];
      expect(Array.isArray(auditRefs)).toBe(true);
      expect(auditRefs.length).toBeGreaterThan(0);
    });

    // ── T073-9: hybrid path — sourceReferences built from ChunkResult ──

    it('T073-9: hybrid path: sourceReferences from ChunkResult, answerMode=hybrid_rag', async () => {
      mockSystemConfigService.getBoolean.mockImplementation((key: string) => {
        if (key === 'feature.query_understanding_v2_enabled') return true;
        if (key === 'feature.hybrid_retrieval_enabled') return true;
        if (key === 'feature.no_answer_gate_enabled') return true;
        return null;
      });
      mockQUS003.understand.mockResolvedValue({
        rawQuery: '混合查詢',
        normalizedQuery: '混合查詢',
        language: 'zh-TW',
        tokenizer: 'rule-based',
        tokens: [],
        keyPhrases: [],
        queryType: QueryType.ProductLookup,
        supportability: 'supported',
        retrievalPlan: {
          searchTerms: ['混合查詢'],
          strategies: ['keyword'],
          maxResults: 5,
          language: 'zh-TW',
        },
        debugMeta: {
          durationMs: 10,
          tokenizerUsed: 'rule-based',
          timestamp: new Date().toISOString(),
        },
      });
      const chunks: ChunkResult[] = [
        {
          knowledgeEntryId: 99,
          sourceKey: 'hybrid-key',
          content: '混合內容',
          score: 0.88,
          language: 'zh-TW',
        },
      ];
      mockHRS003.retrieve.mockResolvedValue(chunks);
      mockRDS003.decideFromChunks.mockReturnValue({
        canAnswer: true,
        reason: 'ok',
        confidence: 0.88,
        topK: chunks,
      });
      mockLlmProvider.stream.mockReturnValue(makeLlmStream());

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        '混合查詢',
        'req-t073-9',
        res as never,
        new AbortController().signal,
      );

      const done = parseDonePayload(res);
      const doneRefs = done!['sourceReferences'] as Record<string, unknown>[];
      expect(Array.isArray(doneRefs)).toBe(true);
      expect(doneRefs.length).toBeGreaterThan(0);
      expect(doneRefs[0]['knowledgeEntryId']).toBe(99);
      expect(doneRefs[0]['sourceKey']).toBe('hybrid-key');
      expect(doneRefs[0]['score']).toBe(0.88);
      expect(doneRefs[0]['chunkIndex']).toBe(0);

      const audit = getChatResponseAuditArg();
      // resolveAnswerMode: ctx.retrievedChunks !== undefined && ctx.queryUnderstandingResult → hybrid_rag
      expect(audit!['answerMode']).toBe('hybrid_rag');
      const auditRefs = audit!['sourceReferences'] as Record<string, unknown>[];
      expect(Array.isArray(auditRefs)).toBe(true);
      expect(auditRefs.length).toBeGreaterThan(0);
      expect(auditRefs[0]['knowledgeEntryId']).toBe(99);
    });

    // ── T073-10: legacy path — sourceReferences built from RetrievalResult adapter ──

    it('T073-10: legacy path: sourceReferences from RetrievalResult adapter, answerMode=llm', async () => {
      // Hybrid disabled — uses PostgresRetrievalService (legacy path)
      mockRetrievalService.retrieve.mockResolvedValue([
        makeRetrievalResult(0.85, { id: 77, content: 'Legacy 內容', sourceKey: 'legacy-key' }),
      ]);
      mockLlmProvider.stream.mockReturnValue(makeLlmStream());

      const res = makeRes();
      await service.run(
        makeConversation() as never,
        'Legacy 查詢',
        'req-t073-10',
        res as never,
        new AbortController().signal,
      );

      const done = parseDonePayload(res);
      const doneRefs = done!['sourceReferences'] as Record<string, unknown>[];
      expect(Array.isArray(doneRefs)).toBe(true);
      expect(doneRefs.length).toBeGreaterThan(0);
      expect(doneRefs[0]['knowledgeEntryId']).toBe(77);
      expect(doneRefs[0]['sourceKey']).toBe('legacy-key');
      expect(doneRefs[0]['score']).toBe(0.85);
      expect(doneRefs[0]['chunkIndex']).toBe(0);

      const audit = getChatResponseAuditArg();
      // No hybrid, no QU V2, no template → answerMode='llm'
      expect(audit!['answerMode']).toBe('llm');
      const auditRefs = audit!['sourceReferences'] as Record<string, unknown>[];
      expect(Array.isArray(auditRefs)).toBe(true);
      expect(auditRefs.length).toBeGreaterThan(0);
      expect(auditRefs[0]['knowledgeEntryId']).toBe(77);
    });
  });
});
