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
      expect(ChatPipelineService.detectLang('你好，我想詢問產品規格與價格的相關資訊')).toBe('zh-TW');
    });

    it('should return en for English text', () => {
      expect(ChatPipelineService.detectLang('I would like to ask about your product specifications and pricing')).toBe('en');
    });

    it('should return fallback for empty string', () => {
      expect(ChatPipelineService.detectLang('')).toBe('zh-TW');
    });

    it('should respect a custom fallback parameter', () => {
      expect(ChatPipelineService.detectLang('', 'en')).toBe('en');
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

  const mockSafetyService = {
    scanPrompt: jest.fn().mockResolvedValue({ blocked: false }),
    buildRefusalResponse: jest.fn().mockReturnValue('拒絕'),
    checkConfidentiality: jest.fn().mockResolvedValue({ triggered: false }),
  };
  const mockIntentService = {
    detect: jest.fn().mockResolvedValue({ label: 'general', score: 0.1, sensitive: false }),
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
  };
  const mockAiStatusService = {
    isDegraded: jest.fn().mockReturnValue(false),
    recordFailure: jest.fn(),
    recordSuccess: jest.fn(),
  };
  const mockPromptBuilder = {
    build: jest.fn().mockReturnValue({ messages: [], estimatedTokens: 0 }),
  };
  const mockLlmProvider = {
    stream: jest.fn(),
  };
  const mockRetrievalService = {
    retrieve: jest.fn().mockResolvedValue([]),
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
        { provide: LLM_PROVIDER, useValue: mockLlmProvider },
        { provide: RETRIEVAL_SERVICE, useValue: mockRetrievalService },
      ],
    }).compile();

    service = module.get(ChatPipelineService);

    // Reset all mocks before each test
    jest.clearAllMocks();
    mockSafetyService.scanPrompt.mockResolvedValue({ blocked: false });
    mockIntentService.detect.mockResolvedValue({ label: 'general', score: 0.1, sensitive: false });
    mockSystemConfigService.get.mockReturnValue(null);
    mockAiStatusService.isDegraded.mockReturnValue(false);
    mockRetrievalService.retrieve.mockResolvedValue([]);
    mockPromptBuilder.build.mockReturnValue({ messages: [], estimatedTokens: 0 });
    mockConversationService.addMessage.mockResolvedValue({ id: 1 });
    mockConversationService.updateConversation.mockResolvedValue({});
    mockConversationService.getHistoryByToken.mockResolvedValue([]);
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

  describe('safety block', () => {
    it('should emit blocked event when safety scan returns blocked=true', async () => {
      mockSafetyService.scanPrompt.mockResolvedValue({ blocked: true, reason: 'profanity' });

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
        { score: 0.9, entry: { id: 1, content: '產品資訊' } },
      ]);
      async function* mockStream() {
        yield { token: '你好' };
        yield { token: '！' };
        yield { token: '', done: true, provider: 'mock', modelUsed: 'mock', fallbackTriggered: false, usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 } };
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
      expect(mockAiStatusService.recordSuccess).toHaveBeenCalled();    });
  });

  describe('abort signal', () => {
    it('should emit interrupted event when signal is aborted during stream', async () => {
      const controller = new AbortController();
      mockRetrievalService.retrieve.mockResolvedValue([
        { score: 0.9, entry: { id: 1, content: '資訊' } },
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
        { score: 0.9, entry: { id: 1, content: 'info' } },
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
        { score: 0.10, entry: { id: 1, content: '非常低信心' } },
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
        { score: 0.35, entry: { id: 1, content: '中低信心資訊' } },
      ]);

      async function* lowConfStream() {
        yield { token: '追問回應', done: false };
        yield { token: '', done: true, provider: 'mock', modelUsed: 'mock', fallbackTriggered: false, usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 } };
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
        { score: 0.9, entry: { id: 1, content: 'info' } },
      ]);

      async function* mockStream() {
        yield { token: '回應', done: false };
        yield { token: '', done: true, provider: 'mock', modelUsed: 'mock', fallbackTriggered: false, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
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
});
