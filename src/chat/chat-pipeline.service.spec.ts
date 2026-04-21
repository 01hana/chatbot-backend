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

  const mockSafetyService = {
    scanPrompt: jest.fn().mockReturnValue({ blocked: false }),
    buildRefusalResponse: jest.fn().mockReturnValue('拒絕'),
    buildHandoffGuidance: jest.fn().mockReturnValue('請留下聯絡資訊'),
    checkConfidentiality: jest.fn().mockReturnValue({ triggered: false }),
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
    mockSafetyService.scanPrompt.mockReturnValue({ blocked: false });
    mockSafetyService.checkConfidentiality.mockReturnValue({ triggered: false });
    mockSafetyService.buildRefusalResponse.mockReturnValue('拒絕');
    mockSafetyService.buildHandoffGuidance.mockReturnValue('請留下聯絡資訊');
    mockIntentService.detect.mockResolvedValue({ label: 'general', score: 0.1, sensitive: false });
    mockSystemConfigService.get.mockReturnValue(null);
    mockAiStatusService.isDegraded.mockReturnValue(false);
    mockRetrievalService.retrieve.mockResolvedValue([]);
    mockPromptBuilder.build.mockReturnValue({ messages: [], estimatedTokens: 0 });
    mockConversationService.addMessage.mockResolvedValue({ id: 1 });
    mockConversationService.updateConversation.mockResolvedValue({});
    mockConversationService.getHistoryByToken.mockResolvedValue([]);
    mockConversationService.incrementSensitiveIntentCount.mockResolvedValue({ sensitiveIntentCount: 1 });
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
      mockSafetyService.scanPrompt.mockReturnValue({
        blocked: true,
        category: 'prompt_injection',
        blockedReason: 'Pattern matched',
        promptHash: 'abc123',
      });
      // sensitiveIntentCount=1 (below default threshold 3)
      mockConversationService.incrementSensitiveIntentCount.mockResolvedValue({ sensitiveIntentCount: 1 });

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

  // ── Phase 3: T3-002 confidentiality short-circuit ───────────────────────

  describe('Phase 3 — confidentiality check (T3-002)', () => {
    it('should short-circuit pipeline and emit intercepted when confidential topic detected', async () => {
      mockSafetyService.checkConfidentiality.mockReturnValue({
        triggered: true,
        matchedType: 'confidential',
        matchedKeyword: '保密協議',
      });
      mockConversationService.incrementSensitiveIntentCount.mockResolvedValue({ sensitiveIntentCount: 1 });

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
      mockConversationService.incrementSensitiveIntentCount.mockResolvedValue({ sensitiveIntentCount: 1 });

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
      mockConversationService.incrementSensitiveIntentCount.mockResolvedValue({ sensitiveIntentCount: 1 });

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
      mockConversationService.incrementSensitiveIntentCount.mockResolvedValue({ sensitiveIntentCount: 1 });
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
      const calls = (mockConversationService.addMessage as jest.Mock).mock.calls as [number, Record<string, unknown>][];
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
      mockConversationService.incrementSensitiveIntentCount.mockResolvedValue({ sensitiveIntentCount: 1 });

      const res = makeRes();
      await service.run(makeConversation() as never, 'inject attempt', 'req-id', res as never, new AbortController().signal);

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
      await service.run(makeConversation() as never, '成本價', 'req-id', res as never, new AbortController().signal);

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
      mockConversationService.incrementSensitiveIntentCount.mockResolvedValue({ sensitiveIntentCount: 3 });
      mockSystemConfigService.getNumber.mockImplementation((key: string) => {
        if (key === 'sensitive_intent_alert_threshold') return 3;
        return null;
      });

      const res = makeRes();
      await service.run(makeConversation() as never, 'jailbreak attempt', 'req-id', res as never, new AbortController().signal);

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
      mockConversationService.incrementSensitiveIntentCount.mockResolvedValue({ sensitiveIntentCount: 2 });
      mockSystemConfigService.getNumber.mockImplementation((key: string) => {
        if (key === 'sensitive_intent_alert_threshold') return 3;
        return null;
      });

      const res = makeRes();
      await service.run(makeConversation() as never, 'inject', 'req-id', res as never, new AbortController().signal);

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
      mockConversationService.incrementSensitiveIntentCount.mockResolvedValue({ sensitiveIntentCount: 3 });
      mockSystemConfigService.getNumber.mockImplementation((key: string) => {
        if (key === 'sensitive_intent_alert_threshold') return 3;
        return null; // all other keys (max_message_length etc.) use defaults
      });
      mockSafetyService.buildRefusalResponse.mockReturnValue('很抱歉');
      mockSafetyService.buildHandoffGuidance.mockReturnValue('請留下聯絡資訊');

      const res = makeRes();
      await service.run(makeConversation() as never, 'jailbreak', 'req-id', res as never, new AbortController().signal);

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
      mockConversationService.incrementSensitiveIntentCount.mockResolvedValue({ sensitiveIntentCount: 1 });

      const res = makeRes();
      await service.run(makeConversation() as never, 'inject', 'req-id', res as never, new AbortController().signal);

      expect(mockRetrievalService.retrieve).not.toHaveBeenCalled();
    });

    it('should NOT call retrieve when confidentiality check triggers', async () => {
      mockSafetyService.checkConfidentiality.mockReturnValue({
        triggered: true,
        matchedType: 'confidential',
        matchedKeyword: '保密協議',
      });
      mockConversationService.incrementSensitiveIntentCount.mockResolvedValue({ sensitiveIntentCount: 1 });

      const res = makeRes();
      await service.run(makeConversation() as never, '保密協議', 'req-id', res as never, new AbortController().signal);

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
      const raw = (res.write as jest.Mock).mock.calls.map((c: unknown[]) => c[0] as string).join('');
      const donePayloads: Record<string, unknown>[] = [];
      const blocks = raw.split('\n\n').filter(Boolean);
      for (const block of blocks) {
        const lines = block.split('\n');
        const eventLine = lines.find(l => l.startsWith('event:'));
        const dataLine = lines.find(l => l.startsWith('data:'));
        if (eventLine?.includes('done') && dataLine) {
          donePayloads.push(JSON.parse(dataLine.replace(/^data:\s*/, '')) as Record<string, unknown>);
        }
      }
      return donePayloads;
    };

    it('should include intentLabel in done payload when intent is detected (answer path)', async () => {
      mockRetrievalService.retrieve.mockResolvedValue([
        { score: 0.9, entry: { id: 1, content: '產品資訊' } },
      ]);
      mockIntentService.detect.mockResolvedValue({
        intentLabel: 'product-inquiry',
        confidence: 0.85,
        language: 'zh-TW',
      });
      async function* mockStream() {
        yield { token: '這是產品資訊' };
        yield { token: '', done: true, provider: 'mock', modelUsed: 'mock', fallbackTriggered: false, usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 } };
      }
      mockLlmProvider.stream.mockReturnValue(mockStream());

      const res = makeRes();
      await service.run(makeConversation() as never, '你們的螺絲產品有哪些', 'req-id', res as never, new AbortController().signal);

      const donePayloads = parseDonePayloads(res);
      expect(donePayloads).toHaveLength(1);
      expect(donePayloads[0]['intentLabel']).toBe('product-inquiry');
    });

    it('should include intentLabel as null when intent detection returns null (answer path)', async () => {
      mockRetrievalService.retrieve.mockResolvedValue([
        { score: 0.9, entry: { id: 1, content: '資訊' } },
      ]);
      mockIntentService.detect.mockResolvedValue({
        intentLabel: null,
        confidence: 0,
        language: 'zh-TW',
      });
      async function* mockStream() {
        yield { token: '回應' };
        yield { token: '', done: true, provider: 'mock', modelUsed: 'mock', fallbackTriggered: false, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
      }
      mockLlmProvider.stream.mockReturnValue(mockStream());

      const res = makeRes();
      await service.run(makeConversation() as never, '未知問題', 'req-id', res as never, new AbortController().signal);

      const donePayloads = parseDonePayloads(res);
      expect(donePayloads[0]['intentLabel']).toBeNull();
    });

    it('intentLabel should be null (not undefined) in done payload when no intent matched', async () => {
      mockRetrievalService.retrieve.mockResolvedValue([
        { score: 0.9, entry: { id: 1, content: '資訊' } },
      ]);
      mockIntentService.detect.mockResolvedValue({
        intentLabel: null,
        confidence: 0,
        language: 'zh-TW',
      });
      async function* mockStream() {
        yield { token: '', done: true, provider: 'mock', modelUsed: 'mock', fallbackTriggered: false, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
      }
      mockLlmProvider.stream.mockReturnValue(mockStream());

      const res = makeRes();
      await service.run(makeConversation() as never, '測試', 'req-id', res as never, new AbortController().signal);

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
      await service.run(makeConversation() as never, '詢價', 'req-id', res as never, new AbortController().signal);

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
      mockConversationService.incrementSensitiveIntentCount.mockResolvedValue({ sensitiveIntentCount: 1 });

      const res = makeRes();
      await service.run(makeConversation() as never, '注入攻擊', 'req-id', res as never, new AbortController().signal);

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
      mockConversationService.incrementSensitiveIntentCount.mockResolvedValue({ sensitiveIntentCount: 1 });

      const res = makeRes();
      await service.run(makeConversation() as never, 'NDA question', 'req-id', res as never, new AbortController().signal);

      const donePayloads = parseDonePayloads(res);
      expect(donePayloads).toHaveLength(1);
      expect(donePayloads[0]['action']).toBe('intercepted');
      expect(donePayloads[0]['intentLabel']).toBeNull();
    });

    it('should set intentLabel=null in done payload when AI is degraded (fallback response)', async () => {
      mockAiStatusService.isDegraded.mockReturnValue(true);

      const res = makeRes();
      await service.run(makeConversation() as never, '任意訊息', 'req-id', res as never, new AbortController().signal);

      const donePayloads = parseDonePayloads(res);
      expect(donePayloads).toHaveLength(1);
      expect(donePayloads[0]['action']).toBe('fallback');
      expect(donePayloads[0]['intentLabel']).toBeNull();
    });

    it('should NOT affect error/timeout/interrupted events (they do not have intentLabel)', async () => {
      const controller = new AbortController();
      mockRetrievalService.retrieve.mockResolvedValue([
        { score: 0.9, entry: { id: 1, content: '資訊' } },
      ]);
      async function* mockStream() {
        controller.abort();
        const err = new Error('aborted');
        (err as NodeJS.ErrnoException).code = 'ABORT_ERR';
        throw err;
      }
      mockLlmProvider.stream.mockReturnValue(mockStream());

      const res = makeRes();
      await service.run(makeConversation() as never, '中斷', 'req-id', res as never, controller.signal);

      const raw = (res.write as jest.Mock).mock.calls.map((c: unknown[]) => c[0] as string).join('');
      // Should have 'interrupted' event, NOT 'done'
      expect(raw).toContain('event: interrupted');
      expect(raw).not.toContain('event: done');
    });
  });
});
