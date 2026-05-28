import type { Conversation, ConversationMessage } from '../generated/prisma/client';
import { ConversationService } from '../conversation/conversation.service';
import { IntentService } from '../intent/intent.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { LeadPromptEnricherService } from './lead-prompt-enricher.service';

describe('LeadPromptEnricherService', () => {
  const makeConversation = (): Conversation =>
    ({
      id: 1,
      sessionId: 'session-1',
      session_token: 'token-1',
      status: 'open',
      type: 'normal',
      riskLevel: null,
      sensitiveIntentCount: 0,
      highIntentScore: 0,
      diagnosisContext: null,
      language: 'zh-TW',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    }) as Conversation;

  const makeMessage = (role: 'user' | 'assistant', content: string): ConversationMessage =>
    ({ role, content } as ConversationMessage);

  const makeIntentService = () =>
    ({
      isHighIntent: jest.fn(),
    }) as unknown as jest.Mocked<Pick<IntentService, 'isHighIntent'>>;

  const makeSystemConfigService = () =>
    ({
      get: jest.fn().mockReturnValue(null),
    }) as unknown as jest.Mocked<Pick<SystemConfigService, 'get'>>;

  const makeConversationService = () =>
    ({
      updateConversation: jest.fn().mockResolvedValue({}),
    }) as unknown as jest.Mocked<Pick<ConversationService, 'updateConversation'>>;

  const makeService = (
    intentService: jest.Mocked<Pick<IntentService, 'isHighIntent'>>,
    systemConfigService: jest.Mocked<Pick<SystemConfigService, 'get'>>,
    conversationService: jest.Mocked<Pick<ConversationService, 'updateConversation'>>,
  ): LeadPromptEnricherService =>
    new LeadPromptEnricherService(
      intentService as unknown as IntentService,
      systemConfigService as unknown as SystemConfigService,
      conversationService as unknown as ConversationService,
    );

  it('does not append prompt when highIntent=false and intentLabel is not price-inquiry', async () => {
    const intentService = makeIntentService();
    const systemConfigService = makeSystemConfigService();
    const conversationService = makeConversationService();
    intentService.isHighIntent.mockReturnValue({
      isHighIntent: false,
      score: 0,
      matchedKeywords: [],
    });

    const service = makeService(intentService, systemConfigService, conversationService);
    const result = await service.enrich({
      conversation: makeConversation(),
      history: [makeMessage('user', '你好')],
      userMessage: '一般詢問',
      assistantContent: '這是回覆',
      language: 'zh-TW',
      intentLabel: 'general-faq',
    });

    expect(result.leadPrompted).toBe(false);
    expect(result.content).toBe('這是回覆');
  });

  it('appends prompt when highIntent=true', async () => {
    const intentService = makeIntentService();
    const systemConfigService = makeSystemConfigService();
    const conversationService = makeConversationService();
    intentService.isHighIntent.mockReturnValue({
      isHighIntent: true,
      score: 3,
      matchedKeywords: ['報價'],
    });

    const service = makeService(intentService, systemConfigService, conversationService);
    const result = await service.enrich({
      conversation: makeConversation(),
      history: [],
      userMessage: '我要報價',
      assistantContent: '這是回覆',
      language: 'zh-TW',
      intentLabel: 'general-faq',
    });

    expect(result.leadPrompted).toBe(true);
    expect(result.content).toContain('這是回覆');
    expect(result.content).toContain('如果您願意，也可以留下姓名');
  });

  it('appends prompt when intentLabel=price-inquiry even if highIntent=false', async () => {
    const intentService = makeIntentService();
    const systemConfigService = makeSystemConfigService();
    const conversationService = makeConversationService();
    intentService.isHighIntent.mockReturnValue({
      isHighIntent: false,
      score: 1,
      matchedKeywords: [],
    });

    const service = makeService(intentService, systemConfigService, conversationService);
    const result = await service.enrich({
      conversation: makeConversation(),
      history: [],
      userMessage: '價格多少',
      assistantContent: '這是回覆',
      language: 'zh-TW',
      intentLabel: 'price-inquiry',
    });

    expect(result.leadPrompted).toBe(true);
    expect(result.content).toContain('如果您願意，也可以留下姓名');
  });

  it('uses zh-TW fallback prompt text by default', async () => {
    const intentService = makeIntentService();
    const systemConfigService = makeSystemConfigService();
    const conversationService = makeConversationService();
    intentService.isHighIntent.mockReturnValue({
      isHighIntent: true,
      score: 2,
      matchedKeywords: ['詢價'],
    });

    const service = makeService(intentService, systemConfigService, conversationService);
    const result = await service.enrich({
      conversation: makeConversation(),
      history: [],
      userMessage: '詢價',
      assistantContent: '回覆',
      language: 'zh-TW',
      intentLabel: 'general-faq',
    });

    expect(result.content).toContain('如果您願意，也可以留下姓名');
  });

  it('uses en fallback prompt text by default', async () => {
    const intentService = makeIntentService();
    const systemConfigService = makeSystemConfigService();
    const conversationService = makeConversationService();
    intentService.isHighIntent.mockReturnValue({
      isHighIntent: true,
      score: 2,
      matchedKeywords: ['quote'],
    });

    const service = makeService(intentService, systemConfigService, conversationService);
    const result = await service.enrich({
      conversation: makeConversation(),
      history: [],
      userMessage: 'need quote',
      assistantContent: 'reply',
      language: 'en',
      intentLabel: 'general-faq',
    });

    expect(result.content).toContain('You may also leave your name, email, company');
  });

  it('prefers SystemConfig lead prompt text over fallback', async () => {
    const intentService = makeIntentService();
    const systemConfigService = makeSystemConfigService();
    const conversationService = makeConversationService();
    systemConfigService.get.mockImplementation((key: string) => {
      if (key === 'lead_prompt_text_zh') return '自訂中文留資提示';
      return undefined;
    });
    intentService.isHighIntent.mockReturnValue({
      isHighIntent: true,
      score: 2,
      matchedKeywords: ['報價'],
    });

    const service = makeService(intentService, systemConfigService, conversationService);
    const result = await service.enrich({
      conversation: makeConversation(),
      history: [],
      userMessage: '我要報價',
      assistantContent: '回覆',
      language: 'zh-TW',
      intentLabel: 'general-faq',
    });

    expect(result.content).toContain('自訂中文留資提示');
    expect(result.content).not.toContain('如果您願意，也可以留下姓名');
  });

  it('updates Conversation.highIntentScore', async () => {
    const intentService = makeIntentService();
    const systemConfigService = makeSystemConfigService();
    const conversationService = makeConversationService();
    intentService.isHighIntent.mockReturnValue({
      isHighIntent: true,
      score: 4,
      matchedKeywords: ['報價', 'quotation'],
    });
    const conversation = makeConversation();

    const service = makeService(intentService, systemConfigService, conversationService);
    await service.enrich({
      conversation,
      history: [],
      userMessage: '報價',
      assistantContent: '回覆',
      language: 'zh-TW',
      intentLabel: 'price-inquiry',
    });

    expect(conversationService.updateConversation).toHaveBeenCalledWith(
      conversation.sessionId,
      { highIntentScore: 4 },
    );
  });

  it('does not depend on LeadService or TicketService', () => {
    const intentService = makeIntentService();
    const systemConfigService = makeSystemConfigService();
    const conversationService = makeConversationService();
    const service = makeService(intentService, systemConfigService, conversationService);

    expect(service).toBeInstanceOf(LeadPromptEnricherService);
  });
});