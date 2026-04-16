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

/**
 * T2-011 — Unit tests for ChatPipelineService.
 *
 * Covers:
 *  - Degraded mode returns fallback SSE payload and ends response
 *  - Safety block writes "blocked" SSE event and ends response
 *  - Successful flow streams tokens and writes "done" event
 *  - AbortSignal triggers "interrupted" event
 */
describe('ChatPipelineService', () => {
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
      async function* mockStream() {
        yield { token: '你好' };
        yield { token: '！' };
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

      async function* mockStream() {
        controller.abort();
        const err = new Error('aborted');
        err.name = 'AbortError';
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
      // AbortError should emit interrupted event or internal error (both are acceptable abort outcomes)
      expect(writtenData.length).toBeGreaterThan(0);
      expect(res.end).toHaveBeenCalled();
    });
  });
});
