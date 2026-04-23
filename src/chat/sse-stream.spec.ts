import { Test, TestingModule } from '@nestjs/testing';
import type { Response, Request } from 'express';
import { NotFoundException } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatPipelineService } from './chat-pipeline.service';
import { ConversationService } from '../conversation/conversation.service';
import { WidgetConfigService } from '../widget-config/widget-config.service';
import { WidgetConfigController } from '../widget-config/widget-config.controller';
import { SystemConfigService } from '../system-config/system-config.service';
import { AiStatusService } from '../health/ai-status.service';

/**
 * T2-016 — SSE stream / sessionToken / history / Widget Config acceptance tests.
 *
 * All tests run with mock providers — no real OpenAI API calls.
 *
 * Covers:
 *  1. POST /chat/sessions  → returns UUID sessionToken
 *  2. POST /chat/sessions/:token/messages → SSE event:token + event:done format
 *  3. POST /chat/sessions/:token/messages → 404 when sessionToken not found
 *  4. GET  /chat/sessions/:token/history  → returns ConversationMessage list
 *  5. GET  /chat/sessions/:token/history  → 404 when sessionToken not found
 *  6. POST /chat/sessions/:token/messages → AbortController aborted on disconnect (close event)
 *  7. POST /chat/sessions/:token/handoff  → Phase 5 stub: accepted=false, action=handoff
 *  8. POST /chat/sessions/:token/handoff  → 404 when sessionToken not found
 *  9. GET  /widget/config  → returns multi-language JSONB shape
 * 10. GET  /widget/config  → status degraded when AiStatusService.isDegraded()
 */

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface MockRes extends jest.Mocked<Partial<Response>> {
  _listeners: Record<string, (() => void)[]>;
}

function makeRes(): MockRes {
  const _listeners: Record<string, (() => void)[]> = {};
  return {
    setHeader: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
    flushHeaders: jest.fn(),
    status: jest.fn().mockReturnThis() as unknown as jest.MockedFunction<Response['status']>,
    json: jest.fn(),
    on: jest.fn((event: string, cb: () => void) => {
      _listeners[event] = _listeners[event] ?? [];
      _listeners[event].push(cb);
    }) as unknown as jest.MockedFunction<Response['on']>,
    _listeners,
  };
}

function makeReq(extra: Record<string, unknown> = {}): Partial<Request> & { requestId?: string } {
  return { headers: {}, requestId: 'test-req', ...extra };
}

const SAMPLE_CONVERSATION = {
  id: 1,
  sessionId: 'internal-uuid',
  session_token: 'ext-token-abc',
  status: 'active',
  type: 'standard',
  riskLevel: null,
  sensitiveIntentCount: 0,
  highIntentScore: 0,
  diagnosisContext: null,
  language: 'zh-TW',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  deletedAt: null,
};

const SAMPLE_MESSAGES = [
  { id: 1, conversationId: 1, role: 'user', content: '你好', type: 'normal', riskLevel: null, blockedReason: null, createdAt: new Date('2026-01-01') },
  { id: 2, conversationId: 1, role: 'assistant', content: '您好！', type: 'normal', riskLevel: null, blockedReason: null, createdAt: new Date('2026-01-01') },
];

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('T2-016 SSE / sessionToken / Widget acceptance (mock)', () => {
  // ── ChatController tests ─────────────────────────────────────────────────

  describe('ChatController', () => {
    let chatController: ChatController;

    const mockConversationService = {
      createSession: jest.fn(),
      findBySessionToken: jest.fn(),
      getHistoryByToken: jest.fn(),
      addMessage: jest.fn(),
      updateConversation: jest.fn(),
    };
    const mockChatPipeline = {
      run: jest.fn().mockResolvedValue(undefined),
    };

    beforeEach(async () => {
      jest.clearAllMocks();

      const module: TestingModule = await Test.createTestingModule({
        controllers: [ChatController],
        providers: [
          { provide: ConversationService, useValue: mockConversationService },
          { provide: ChatPipelineService, useValue: mockChatPipeline },
        ],
      }).compile();

      chatController = module.get(ChatController);
    });

    // Test 1: POST /sessions → returns UUID sessionToken
    it('should return sessionToken and createdAt when creating a session', async () => {
      mockConversationService.createSession.mockResolvedValueOnce({
        sessionToken: 'ext-token-abc',
        createdAt: new Date('2026-01-01'),
      });

      const result = await chatController.createSession({ language: 'zh-TW' });

      expect(result).toMatchObject({ sessionToken: 'ext-token-abc' });
      expect(result.sessionToken).toMatch(/^[a-z0-9-]+$/i);
    });

    // Test 2: SSE sendMessage writes event:token and event:done
    it('should call chatPipeline.run and write SSE events for valid session', async () => {
      mockConversationService.findBySessionToken.mockResolvedValueOnce(SAMPLE_CONVERSATION);
      mockChatPipeline.run.mockImplementationOnce(async (_conv, _msg, _reqId, res: Response) => {
        res.write('event: token\ndata: {"token":"hello"}\n\n');
        res.write('event: done\ndata: {"messageId":2,"action":"answer","sourceReferences":[],"usage":{"promptTokens":5,"completionTokens":5,"totalTokens":10}}\n\n');
        res.end();
      });

      const res = makeRes();
      const req = makeReq();
      await chatController.sendMessage(
        'ext-token-abc',
        { message: '你好' },
        req as Request & { requestId?: string },
        res as unknown as Response,
      );

      expect(mockChatPipeline.run).toHaveBeenCalledTimes(1);
      const writeCalls = (res.write as jest.Mock).mock.calls.map(([arg]) => arg as string);
      const tokenEvent = writeCalls.find((w) => w.includes('event: token'));
      const doneEvent = writeCalls.find((w) => w.includes('event: done'));
      expect(tokenEvent).toBeDefined();
      expect(doneEvent).toBeDefined();
    });

    // Test 3: 404 when sessionToken not found (sendMessage)
    it('should return 404 when sessionToken is not found (sendMessage)', async () => {
      mockConversationService.findBySessionToken.mockResolvedValueOnce(null);

      const res = makeRes();
      const req = makeReq();
      await chatController.sendMessage(
        'no-such-token',
        { message: 'hi' },
        req as Request & { requestId?: string },
        res as unknown as Response,
      );

      expect((res.status as jest.Mock)).toHaveBeenCalledWith(404);
      expect(mockChatPipeline.run).not.toHaveBeenCalled();
    });

    // Test 4: GET history → returns message list
    it('should return message history for a valid session', async () => {
      mockConversationService.findBySessionToken.mockResolvedValueOnce(SAMPLE_CONVERSATION);
      mockConversationService.getHistoryByToken.mockResolvedValueOnce(SAMPLE_MESSAGES);

      const result = await chatController.getHistory('ext-token-abc');

      expect(result.sessionToken).toBe('ext-token-abc');
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0]).toMatchObject({ role: 'user', content: '你好' });
      expect(result.messages[1]).toMatchObject({ role: 'assistant', content: '您好！' });
    });

    // Test 5: GET history → 404 when not found
    it('should throw NotFoundException for unknown sessionToken (history)', async () => {
      mockConversationService.findBySessionToken.mockResolvedValueOnce(null);

      await expect(chatController.getHistory('ghost-token')).rejects.toThrow(NotFoundException);
    });

    // Test 6: AbortController aborted on client disconnect
    it('should register close listener on the response and abort on disconnect', async () => {
      mockConversationService.findBySessionToken.mockResolvedValueOnce(SAMPLE_CONVERSATION);

      let capturedSignal: AbortSignal | undefined;
      mockChatPipeline.run.mockImplementationOnce((_conv, _msg, _reqId, _res, signal: AbortSignal) => {
        capturedSignal = signal;
        return Promise.resolve();
      });

      const res = makeRes();
      const req = makeReq();
      await chatController.sendMessage(
        'ext-token-abc',
        { message: 'hi' },
        req as Request & { requestId?: string },
        res as unknown as Response,
      );

      expect(capturedSignal).toBeDefined();
      expect(capturedSignal!.aborted).toBe(false);

      // Simulate client disconnect
      const closeCbs = res._listeners['close'] ?? [];
      expect(closeCbs.length).toBeGreaterThan(0);
      closeCbs.forEach((cb) => cb());
      expect(capturedSignal!.aborted).toBe(true);
    });

    // Test 7: Handoff returns Phase 5 stub (accepted=false, action=handoff)
    it('should return accepted=false Phase 5 stub for handoff', async () => {
      mockConversationService.findBySessionToken.mockResolvedValueOnce(SAMPLE_CONVERSATION);

      const result = await chatController.handoff('ext-token-abc', { reason: 'test handoff' });

      expect(result.accepted).toBe(false);
      expect(result.action).toBe('handoff');
    });

    // Test 8: Handoff 404 when not found
    it('should throw NotFoundException when sessionToken not found (handoff)', async () => {
      mockConversationService.findBySessionToken.mockResolvedValueOnce(null);

      await expect(chatController.handoff('no-token', {})).rejects.toThrow(NotFoundException);
    });
  });

  // ── WidgetConfigController tests ─────────────────────────────────────────

  describe('WidgetConfigController', () => {
    let widgetController: WidgetConfigController;

    const mockWidgetConfigService = {
      getConfig: jest.fn(),
    };

    beforeEach(async () => {
      jest.clearAllMocks();

      const module: TestingModule = await Test.createTestingModule({
        controllers: [WidgetConfigController],
        providers: [
          { provide: WidgetConfigService, useValue: mockWidgetConfigService },
        ],
      }).compile();

      widgetController = module.get(WidgetConfigController);
    });

    // Test 9: GET /widget/config → multi-language JSONB shape
    it('should return multi-language widget config', () => {
      const config = {
        status: 'online',
        welcomeMessage: { 'zh-TW': '歡迎', en: 'Welcome' },
        quickReplies: { 'zh-TW': ['查詢'], en: ['Enquire'] },
        disclaimer: { 'zh-TW': '免責聲明', en: 'Disclaimer' },
        fallbackMessage: { 'zh-TW': '請稍後', en: 'Please wait' },
      };
      mockWidgetConfigService.getConfig.mockReturnValueOnce(config);

      const result = widgetController.getConfig();
      expect(result).toMatchObject(config);
      expect(result.status).toBe('online');
      expect(result.welcomeMessage).toMatchObject({ 'zh-TW': '歡迎', en: 'Welcome' });
      expect(result.quickReplies).toMatchObject({ 'zh-TW': ['查詢'] });
    });

    // Test 10: GET /widget/config → status=degraded when AI is degraded
    it('should return status=degraded when AI is degraded', () => {
      const config = {
        status: 'degraded',
        welcomeMessage: { 'zh-TW': '歡迎', en: 'Welcome' },
        quickReplies: { 'zh-TW': [], en: [] },
        disclaimer: { 'zh-TW': '', en: '' },
        fallbackMessage: { 'zh-TW': '忙碌中', en: 'Busy' },
      };
      mockWidgetConfigService.getConfig.mockReturnValueOnce(config);

      const result = widgetController.getConfig();
      expect(result.status).toBe('degraded');
    });
  });

  // ── WidgetConfigService unit tests ────────────────────────────────────────

  describe('WidgetConfigService', () => {
    let widgetService: WidgetConfigService;

    const mockSystemConfigService = {
      get: jest.fn().mockReturnValue(null),
      getNumber: jest.fn().mockReturnValue(null),
    };
    const mockAiStatusService = {
      isDegraded: jest.fn().mockReturnValue(false),
      recordFailure: jest.fn(),
      recordSuccess: jest.fn(),
    };

    beforeEach(async () => {
      jest.clearAllMocks();

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WidgetConfigService,
          { provide: SystemConfigService, useValue: mockSystemConfigService },
          { provide: AiStatusService, useValue: mockAiStatusService },
        ],
      }).compile();

      widgetService = module.get(WidgetConfigService);
    });

    it('should return online status when not degraded', () => {
      mockSystemConfigService.get.mockReturnValue(null);
      mockAiStatusService.isDegraded.mockReturnValue(false);

      const config = widgetService.getConfig();
      expect(config.status).toBe('online');
    });

    it('should override status to degraded when AiStatusService.isDegraded() is true', () => {
      mockAiStatusService.isDegraded.mockReturnValue(true);

      const config = widgetService.getConfig();
      expect(config.status).toBe('degraded');
    });

    it('should parse valid JSON from SystemConfig', () => {
      mockSystemConfigService.get.mockImplementation((key: string) => {
        if (key === 'widget_welcome_message') {
          return JSON.stringify({ 'zh-TW': '測試', en: 'Test' });
        }
        return null;
      });

      const config = widgetService.getConfig();
      expect(config.welcomeMessage['zh-TW']).toBe('測試');
      expect(config.welcomeMessage['en']).toBe('Test');
    });

    it('should fall back to default values when SystemConfig key is absent', () => {
      mockSystemConfigService.get.mockReturnValue(null);

      const config = widgetService.getConfig();
      expect(config.welcomeMessage).toBeDefined();
      expect(config.welcomeMessage['zh-TW']).toBeTruthy();
    });
  });
});
