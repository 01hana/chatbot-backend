import { SummaryService } from './summary.service';
import { ILlmProvider } from '../llm/interfaces/llm-provider.interface';
import { AuditService } from '../audit/audit.service';
import type { ConversationMessage } from '../generated/prisma/client';

describe('SummaryService', () => {
  const makeMessage = (content: string): ConversationMessage =>
    ({
      content,
      role: 'user',
    } as ConversationMessage);

  const makeLlmProvider = () => ({
    chat: jest.fn(),
    stream: jest.fn(),
  }) as unknown as jest.Mocked<ILlmProvider>;

  const makeAuditService = () => ({
    log: jest.fn().mockResolvedValue(undefined),
  }) as unknown as jest.Mocked<Pick<AuditService, 'log'>>;

  it('returns LLM summary and writes summary_generated audit log', async () => {
    const llmProvider = makeLlmProvider();
    const auditService = makeAuditService();
    llmProvider.chat.mockResolvedValue({
      content: '使用者想詢問產品規格、材質與報價。',
      promptTokens: 12,
      completionTokens: 24,
      totalTokens: 36,
      durationMs: 150,
      model: 'gpt-5.4-mini',
      provider: 'openai',
    });

    const service = new SummaryService(llmProvider, auditService as unknown as AuditService);
    const summary = await service.generate(
      [makeMessage('我想詢問這款產品的規格與材質，另外也想知道報價。')],
      'zh-TW',
      { sessionId: 'session-1', requestId: 'request-1' },
    );

    expect(summary).toBe('使用者想詢問產品規格、材質與報價。');
    expect(llmProvider.chat).toHaveBeenCalledTimes(1);
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'summary_generated',
        sessionId: 'session-1',
        requestId: 'request-1',
        promptTokens: 12,
        completionTokens: 24,
        totalTokens: 36,
        durationMs: 150,
        aiModel: 'gpt-5.4-mini',
        aiProvider: 'openai',
        eventData: {
          action: 'summary',
          llmCalled: true,
          messageCount: 1,
        },
      }),
    );
  });

  it('writes token observability to audit log on LLM success', async () => {
    const llmProvider = makeLlmProvider();
    const auditService = makeAuditService();
    llmProvider.chat.mockResolvedValue({
      content: 'The user is asking about product specs and pricing.',
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      durationMs: 80,
      model: 'gpt-5.4-mini',
      provider: 'openai',
    });

    const service = new SummaryService(llmProvider, auditService as unknown as AuditService);
    await service.generate([makeMessage('I need product specs and a quote.')], 'en');

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'summary_generated',
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
        durationMs: 80,
        aiModel: 'gpt-5.4-mini',
        aiProvider: 'openai',
      }),
    );
  });

  it('falls back to template summary when LLM fails without throwing', async () => {
    const llmProvider = makeLlmProvider();
    const auditService = makeAuditService();
    llmProvider.chat.mockRejectedValue(new Error('timeout'));

    const service = new SummaryService(llmProvider, auditService as unknown as AuditService);
    const summary = await service.generate(
      [
        makeMessage('我想看規格。'),
        makeMessage('材質可以改嗎？'),
        makeMessage('尺寸要小一點。'),
      ],
      'zh-TW',
    );

    expect(summary).toBe('使用者近期提到：我想看規格。；材質可以改嗎？；尺寸要小一點。');
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'summary_fallback',
        eventData: {
          action: 'summary',
          llmCalled: false,
          reason: 'timeout',
        },
      }),
    );
  });

  it('falls back when messages are empty', async () => {
    const llmProvider = makeLlmProvider();
    const auditService = makeAuditService();

    const service = new SummaryService(llmProvider, auditService as unknown as AuditService);
    const summary = await service.generate([], 'en');

    expect(summary).toBe('Not enough conversation content to summarize.');
    expect(llmProvider.chat).not.toHaveBeenCalled();
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'summary_fallback',
        eventData: {
          action: 'summary',
          llmCalled: false,
          reason: 'no_messages',
        },
      }),
    );
  });

  it('returns English fallback text when LLM fails', async () => {
    const llmProvider = makeLlmProvider();
    const auditService = makeAuditService();
    llmProvider.chat.mockRejectedValue(new Error('network error'));

    const service = new SummaryService(llmProvider, auditService as unknown as AuditService);
    const summary = await service.generate([makeMessage('Need pricing and dimensions.')], 'en');

    expect(summary).toBe('Recent user messages: Need pricing and dimensions.');
  });

  it('returns zh-TW fallback text when LLM fails', async () => {
    const llmProvider = makeLlmProvider();
    const auditService = makeAuditService();
    llmProvider.chat.mockRejectedValue(new Error('network error'));

    const service = new SummaryService(llmProvider, auditService as unknown as AuditService);
    const summary = await service.generate([makeMessage('需要報價。')], 'zh-TW');

    expect(summary).toBe('使用者近期提到：需要報價。');
  });

  it('never calls a real LLM when provided a mock provider', async () => {
    const llmProvider = makeLlmProvider();
    const auditService = makeAuditService();
    llmProvider.chat.mockResolvedValue({
      content: 'Short summary.',
      promptTokens: 1,
      completionTokens: 2,
      totalTokens: 3,
      durationMs: 10,
      model: 'mock',
      provider: 'mock',
    });

    const service = new SummaryService(llmProvider, auditService as unknown as AuditService);
    const summary = await service.generate([makeMessage('Need a quote.')], 'en');

    expect(summary).toBe('Short summary.');
    expect(llmProvider.chat).toHaveBeenCalledTimes(1);
  });
});