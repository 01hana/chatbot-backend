import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';

import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { PrismaService } from '../src/prisma/prisma.service';
import { LLM_PROVIDER } from '../src/llm/interfaces/llm-provider.interface';
import { RETRIEVAL_SERVICE } from '../src/retrieval/interfaces/retrieval-service.interface';
import { IntentService } from '../src/intent/intent.service';
import { SafetyService } from '../src/safety/safety.service';
import { SystemConfigService } from '../src/system-config/system-config.service';
import { AuditService } from '../src/audit/audit.service';
import { QueryAnalysisService } from '../src/query-analysis/query-analysis.service';
import { AnswerTemplateResolver } from '../src/template/answer-template-resolver';
import { SummaryService } from '../src/chat/summary.service';

type AnyRecord = Record<string, unknown>;

function matchesWhere(item: AnyRecord, where?: AnyRecord): boolean {
  if (!where) return true;
  for (const [key, value] of Object.entries(where)) {
    if (['AND', 'OR', 'NOT'].includes(key)) continue;
    if (value === null || value === undefined) {
      if (item[key] !== null && item[key] !== undefined) return false;
      continue;
    }
    if (typeof value === 'object') continue;
    if (item[key] !== value) return false;
  }
  return true;
}

function buildStatefulMock() {
  let idSeq = 1;
  const nextId = () => idSeq++;

  const conversations = new Map<number, AnyRecord>();
  const conversationByToken = new Map<string, AnyRecord>();
  const conversationBySessionId = new Map<string, AnyRecord>();
  const conversationMessages = new Map<number, AnyRecord>();
  const leads = new Map<number, AnyRecord>();
  const tickets = new Map<number, AnyRecord>();
  const feedbacks = new Map<number, AnyRecord>();

  const now = () => new Date();

  const conversation = {
    create({ data }: { data: AnyRecord }) {
      const id = nextId();
      const row: AnyRecord = {
        id,
        sessionId: randomUUID(),
        session_token: randomUUID(),
        status: 'active',
        type: 'normal',
        language: (data.language as string) ?? 'zh-TW',
        riskLevel: null,
        sensitiveIntentCount: 0,
        highIntentScore: 0,
        diagnosisContext: null,
        createdAt: now(),
        updatedAt: now(),
        deletedAt: null,
      };
      conversations.set(id, row);
      conversationByToken.set(row.session_token as string, row);
      conversationBySessionId.set(row.sessionId as string, row);
      return Promise.resolve(row);
    },
    findUnique({ where, include }: { where: AnyRecord; include?: AnyRecord }) {
      let row: AnyRecord | undefined;
      if (where.session_token !== undefined) {
        row = conversationByToken.get(where.session_token as string);
      } else if (where.sessionId !== undefined) {
        row = conversationBySessionId.get(where.sessionId as string);
      } else if (where.id !== undefined) {
        row = conversations.get(where.id as number);
      }
      if (!row) return Promise.resolve(null);
      if (include?.messages) {
        const msgs = Array.from(conversationMessages.values()).filter(
          (m) => m.conversationId === row!.id,
        );
        return Promise.resolve({ ...row, messages: msgs });
      }
      return Promise.resolve({ ...row });
    },
    findFirst({ where }: { where?: AnyRecord }) {
      const result = Array.from(conversations.values()).find((r) => matchesWhere(r, where));
      return Promise.resolve(result ?? null);
    },
    update({ where, data }: { where: AnyRecord; data: AnyRecord }) {
      const row = where.id !== undefined
        ? conversations.get(where.id as number)
        : where.session_token !== undefined
          ? conversationByToken.get(where.session_token as string)
          : conversationBySessionId.get(where.sessionId as string);
      if (!row) return Promise.resolve(null);
      Object.assign(row, data, { updatedAt: now() });
      return Promise.resolve(row);
    },
    count() {
      return Promise.resolve(conversations.size);
    },
    findMany() {
      return Promise.resolve(Array.from(conversations.values()));
    },
  };

  const conversationMessage = {
    create({ data }: { data: AnyRecord }) {
      const id = nextId();
      const row: AnyRecord = {
        id,
        conversationId: data.conversationId,
        role: data.role,
        content: data.content,
        type: (data.type as string) ?? 'text',
        riskLevel: data.riskLevel ?? null,
        blockedReason: data.blockedReason ?? null,
        createdAt: now(),
      };
      conversationMessages.set(id, row);
      return Promise.resolve(row);
    },
    findUnique({ where }: { where: AnyRecord }) {
      return Promise.resolve(conversationMessages.get(where.id as number) ?? null);
    },
    findMany({ where, orderBy, take }: { where?: AnyRecord; orderBy?: AnyRecord; take?: number }) {
      let rows = Array.from(conversationMessages.values()).filter((r) => matchesWhere(r, where));
      if (orderBy?.createdAt === 'desc') rows = rows.reverse();
      if (take !== undefined) rows = rows.slice(0, take);
      return Promise.resolve(rows);
    },
  };

  const lead = {
    create({ data }: { data: AnyRecord }) {
      const id = nextId();
      const conversationId = (data.conversation as AnyRecord)?.connect
        ? ((data.conversation as AnyRecord).connect as AnyRecord).id
        : data.conversationId;
      const row: AnyRecord = {
        id,
        conversationId,
        name: data.name,
        email: data.email,
        company: data.company ?? null,
        phone: data.phone ?? null,
        message: data.message ?? null,
        language: data.language ?? null,
        type: data.type ?? 'general',
        riskLevel: data.riskLevel ?? null,
        status: data.status ?? 'new',
        confidentialityTriggered: data.confidentialityTriggered ?? false,
        promptInjectionDetected: data.promptInjectionDetected ?? false,
        sensitiveIntentCount: data.sensitiveIntentCount ?? 0,
        highIntentScore: data.highIntentScore ?? 0,
        notificationStatus: data.notificationStatus ?? 'pending',
        notes: data.notes ?? null,
        deletedAt: null,
        createdAt: now(),
        updatedAt: now(),
      };
      leads.set(id, row);
      return Promise.resolve(row);
    },
    findUnique({ where }: { where: AnyRecord }) {
      return Promise.resolve(leads.get(where.id as number) ?? null);
    },
    findFirst({ where }: { where?: AnyRecord }) {
      const result = Array.from(leads.values()).find((r) => matchesWhere(r, where));
      return Promise.resolve(result ?? null);
    },
    findMany() {
      return Promise.resolve(Array.from(leads.values()));
    },
    count() {
      return Promise.resolve(leads.size);
    },
    update({ where, data }: { where: AnyRecord; data: AnyRecord }) {
      const row = leads.get(where.id as number);
      if (!row) return Promise.resolve(null);
      Object.assign(row, data, { updatedAt: now() });
      return Promise.resolve(row);
    },
  };

  const ticket = {
    create({ data }: { data: AnyRecord }) {
      const id = nextId();
      const conversationId = (data.conversation as AnyRecord)?.connect
        ? ((data.conversation as AnyRecord).connect as AnyRecord).id
        : data.conversationId;
      const leadId = (data.lead as AnyRecord)?.connect
        ? ((data.lead as AnyRecord).connect as AnyRecord).id
        : (data.leadId as number | null | undefined) ?? null;
      const row: AnyRecord = {
        id,
        conversationId,
        leadId,
        status: data.status ?? 'open',
        priority: data.priority ?? 'medium',
        triggerReason: data.triggerReason ?? null,
        summary: data.summary ?? null,
        assignee: data.assignee ?? null,
        notes: Array.isArray(data.notes) ? [...(data.notes as unknown[])] : [],
        resolvedAt: null,
        deletedAt: null,
        createdAt: now(),
        updatedAt: now(),
      };
      tickets.set(id, row);
      return Promise.resolve(row);
    },
    findUnique({ where }: { where: AnyRecord }) {
      return Promise.resolve(tickets.get(where.id as number) ?? null);
    },
    findMany() {
      return Promise.resolve(Array.from(tickets.values()));
    },
    findFirst({ where }: { where?: AnyRecord }) {
      const result = Array.from(tickets.values()).find((r) => matchesWhere(r, where));
      return Promise.resolve(result ?? null);
    },
    count() {
      return Promise.resolve(tickets.size);
    },
    update({ where, data }: { where: AnyRecord; data: AnyRecord }) {
      const row = tickets.get(where.id as number);
      if (!row) return Promise.resolve(null);
      Object.assign(row, data, { updatedAt: now() });
      return Promise.resolve(row);
    },
  };

  const feedback = {
    create({ data }: { data: AnyRecord }) {
      const id = nextId();
      const row: AnyRecord = {
        id,
        conversationId: data.conversationId,
        messageId: data.messageId,
        value: data.value,
        reason: data.reason ?? null,
        createdAt: now(),
      };
      feedbacks.set(id, row);
      return Promise.resolve(row);
    },
    findFirst({ where }: { where?: AnyRecord }) {
      const result = Array.from(feedbacks.values()).find((r) => matchesWhere(r, where));
      return Promise.resolve(result ?? null);
    },
    findMany() {
      return Promise.resolve(Array.from(feedbacks.values()));
    },
    deleteMany({ where }: { where?: AnyRecord }) {
      const toDelete: number[] = [];
      for (const [id, row] of feedbacks.entries()) {
        if (matchesWhere(row, where)) toDelete.push(id);
      }
      for (const id of toDelete) feedbacks.delete(id);
      return Promise.resolve({ count: toDelete.length });
    },
    count() {
      return Promise.resolve(feedbacks.size);
    },
    groupBy() {
      return Promise.resolve([]);
    },
  };

  const auditLog = {
    create() {
      return Promise.resolve({});
    },
    findMany() {
      return Promise.resolve([]);
    },
    count() {
      return Promise.resolve(0);
    },
  };

  return {
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    systemConfig: { findMany: jest.fn().mockResolvedValue([]) },
    safetyRule: { findMany: jest.fn().mockResolvedValue([]) },
    blacklistEntry: { findMany: jest.fn().mockResolvedValue([]) },
    intentTemplate: { findMany: jest.fn().mockResolvedValue([]) },
    glossaryTerm: { findMany: jest.fn().mockResolvedValue([]) },
    knowledgeEntry: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
    },
    knowledgeVersion: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    conversation,
    conversationMessage,
    lead,
    ticket,
    feedback,
    auditLog,
    _debug: {
      getConversationByToken: (token: string) => conversationByToken.get(token) ?? null,
      getLeadCount: () => leads.size,
      getTicketCount: () => tickets.size,
    },
  };
}

function parseSseDonePayload(raw: string): AnyRecord | null {
  const blocks = raw.split('\n\n').filter(Boolean);
  for (const block of blocks) {
    const lines = block.split('\n');
    const event = lines.find((line) => line.startsWith('event:'));
    const data = lines.find((line) => line.startsWith('data:'));
    if (event?.includes('done') && data) {
      return JSON.parse(data.replace(/^data:\s*/, '')) as AnyRecord;
    }
  }
  return null;
}

describe('Phase 4-F checkpoint (e2e)', () => {
  let app: INestApplication;
  let mockPrisma: ReturnType<typeof buildStatefulMock>;
  const auditEvents: AnyRecord[] = [];
  const retrievalCalls: AnyRecord[] = [];

  const llmMock = {
    chat: jest.fn(),
    stream: jest.fn(),
  };

  const retrievalMock = {
    retrieve: jest.fn(async (query: AnyRecord) => {
      retrievalCalls.push(query);
      if (query.intentLabel === 'product-spec' && query.rankingProfile === 'diagnosis') {
        return [
          {
            entry: {
              id: 901,
              sourceKey: 'KB-901',
              language: 'zh-TW',
              title: '戶外不鏽鋼螺絲',
              content: '適合戶外與潮濕環境',
              tags: ['戶外', '不鏽鋼'],
            },
            score: 0.93,
          },
        ];
      }
      return [
        {
          entry: {
            id: 101,
            sourceKey: 'KB-101',
            language: 'zh-TW',
            title: '一般知識',
            content: '一般產品資訊',
            tags: ['一般'],
          },
          score: 0.9,
        },
      ];
    }),
  };

  const intentMock = {
    detect: jest.fn(async (input: string) => {
      const msg = input.toLowerCase();
      if (
        msg.includes('多少錢') ||
        msg.includes('price') ||
        msg.includes('quotation')
      ) {
        return { intentLabel: 'price-inquiry', confidence: 0.95, language: 'zh-TW' };
      }
      if (msg.includes('推薦') || msg.includes('螺絲')) {
        return { intentLabel: 'product-diagnosis', confidence: 0.95, language: 'zh-TW' };
      }
      return { intentLabel: null, confidence: 0, language: 'zh-TW' };
    }),
    isHighIntent: jest.fn((history: Array<{ content: string }>) => {
      const kws = ['報價', '多少錢', '詢價', 'price', 'quotation'];
      const matched = new Set<string>();
      let score = 0;
      for (const message of history) {
        const content = message.content.toLowerCase();
        for (const kw of kws) {
          if (content.includes(kw.toLowerCase())) {
            matched.add(kw);
            score += 1;
            break;
          }
        }
      }
      return {
        isHighIntent: score >= 2,
        score,
        matchedKeywords: Array.from(matched),
      };
    }),
    getCachedTemplates: jest.fn(() => [
      { intent: 'diagnosis.purpose', templateZh: '請問您的用途是什麼？', templateEn: 'What is the purpose?', isActive: true },
      { intent: 'diagnosis.material', templateZh: '請問您需要的材質是什麼？', templateEn: 'What material?', isActive: true },
      { intent: 'diagnosis.length', templateZh: '請問您需要的長度是多少？', templateEn: 'What length?', isActive: true },
      { intent: 'diagnosis.environment', templateZh: '請問使用環境為何？', templateEn: 'What environment?', isActive: true },
    ]),
    invalidateCache: jest.fn(),
  };

  const safetyMock = {
    scanPrompt: jest.fn().mockResolvedValue({ blocked: false, promptHash: 'hash' }),
    checkConfidentiality: jest.fn().mockResolvedValue({ triggered: false }),
    buildRefusalResponse: jest.fn().mockReturnValue('拒絕'),
    buildHandoffGuidance: jest.fn().mockReturnValue('請留聯絡資訊'),
  };

  const systemConfigMock = {
    get: jest.fn((key: string) => {
      if (key === 'lead_prompt_text_zh') return '歡迎留下聯絡方式，業務將盡快與您聯繫。';
      if (key === 'lead_prompt_text_en') return 'Please leave your contact info for sales follow-up.';
      if (key === 'fallback_message_zh') return '系統繁忙，請稍後再試。';
      if (key === 'fallback_message_en') return 'System busy, please try again later.';
      return null;
    }),
    getNumber: jest.fn((key: string) => {
      if (key === 'max_message_length') return 2000;
      if (key === 'rag_minimum_score') return 0.25;
      if (key === 'rag_answer_threshold') return 0.55;
      if (key === 'rag_confidence_threshold') return 0.55;
      if (key === 'llm_max_context_tokens') return 8000;
      if (key === 'llm_timeout_ms') return 30000;
      return null;
    }),
    getBoolean: jest.fn(() => false),
  };

  const queryAnalysisMock = {
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
      debugMeta: { processingMs: 1, normalizerSteps: [], expansionHits: 0 },
    }),
  };

  const templateResolverMock = {
    resolve: jest.fn().mockReturnValue({ strategy: 'rag', reason: 'rag:default' }),
  };

  const auditMock = {
    log: jest.fn(async (event: AnyRecord) => {
      auditEvents.push(event);
    }),
  };

  beforeAll(async () => {
    mockPrisma = buildStatefulMock();

    llmMock.stream.mockImplementation(async function* stream() {
      yield { token: '這是模型回覆', done: false };
      yield {
        token: '',
        done: true,
        provider: 'mock',
        modelUsed: 'mock-model',
        fallbackTriggered: false,
        usage: { promptTokens: 5, completionTokens: 7, totalTokens: 12 },
      };
    });

    llmMock.chat.mockResolvedValue({
      content: '這是摘要',
      promptTokens: 8,
      completionTokens: 6,
      totalTokens: 14,
      durationMs: 12,
      model: 'mock-model',
      provider: 'mock',
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .overrideProvider(LLM_PROVIDER)
      .useValue(llmMock)
      .overrideProvider(RETRIEVAL_SERVICE)
      .useValue(retrievalMock)
      .overrideProvider(IntentService)
      .useValue(intentMock)
      .overrideProvider(SafetyService)
      .useValue(safetyMock)
      .overrideProvider(SystemConfigService)
      .useValue(systemConfigMock)
      .overrideProvider(AuditService)
      .useValue(auditMock)
      .overrideProvider(QueryAnalysisService)
      .useValue(queryAnalysisMock)
      .overrideProvider(AnswerTemplateResolver)
      .useValue(templateResolverMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    retrievalCalls.length = 0;
    auditEvents.length = 0;
    jest.clearAllMocks();

    llmMock.stream.mockImplementation(async function* stream() {
      yield { token: '這是模型回覆', done: false };
      yield {
        token: '',
        done: true,
        provider: 'mock',
        modelUsed: 'mock-model',
        fallbackTriggered: false,
        usage: { promptTokens: 5, completionTokens: 7, totalTokens: 12 },
      };
    });

    llmMock.chat.mockResolvedValue({
      content: '這是摘要',
      promptTokens: 8,
      completionTokens: 6,
      totalTokens: 14,
      durationMs: 12,
      model: 'mock-model',
      provider: 'mock',
    });
  });

  it('Phase 4 diagnosis flow works end-to-end and reaches recommended stage', async () => {
    const sessionRes = await request(app.getHttpServer())
      .post('/api/v1/chat/sessions')
      .send({ language: 'zh-TW' })
      .expect(201);

    const sessionToken = sessionRes.body.data.sessionToken as string;

    const sendMessage = async (message: string) =>
      request(app.getHttpServer())
        .post(`/api/v1/chat/sessions/${sessionToken}/messages`)
        .send({ message })
        .expect(201);

    const storedBefore = mockPrisma._debug.getConversationByToken(sessionToken) as AnyRecord;
    storedBefore.diagnosisContext = {
      stage: 'collecting',
      currentField: 'material',
      requiredFields: ['purpose', 'material', 'length', 'environment'],
      collectedFields: {
        purpose: '固定機台用',
      },
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const collectingTurn = await sendMessage('不鏽鋼');
    const collectingDone = parseSseDonePayload(collectingTurn.text);
    expect(collectingDone).not.toBeNull();
    expect(collectingDone?.intentLabel).toBe('product-diagnosis');
    expect(collectingDone?.sourceReferences).toEqual([]);
    expect(retrievalCalls.length).toBe(0);
    expect(llmMock.stream).toHaveBeenCalledTimes(0);

    await sendMessage('20mm');
    expect(retrievalCalls.length).toBe(0);
    expect(llmMock.stream).toHaveBeenCalledTimes(0);

    const completionTurn = await sendMessage('室外潮濕');
    const completionDone = parseSseDonePayload(completionTurn.text);
    expect(completionDone).not.toBeNull();
    expect(Array.isArray(completionDone?.sourceReferences)).toBe(true);
    expect((completionDone?.sourceReferences as unknown[]).length).toBeGreaterThan(0);

    expect(llmMock.stream).toHaveBeenCalledTimes(1);
    expect(retrievalCalls.length).toBeGreaterThan(0);
    for (const call of retrievalCalls) {
      expect(call.intentLabel).toBe('product-spec');
      expect(call.rankingProfile).toBe('diagnosis');
    }

    const storedConversation = mockPrisma._debug.getConversationByToken(sessionToken) as AnyRecord;
    expect(storedConversation).toBeTruthy();
    const diagnosisContext = storedConversation.diagnosisContext as AnyRecord;
    expect(diagnosisContext.stage).toBe('recommended');

    const historyRes = await request(app.getHttpServer())
      .get(`/api/v1/chat/sessions/${sessionToken}/history`)
      .expect(200);
    expect(Array.isArray(historyRes.body.data.messages)).toBe(true);
    expect((historyRes.body.data.messages as unknown[]).length).toBeGreaterThan(0);

    const progressAudit = auditEvents.find((e) => e.eventType === 'diagnosis_progress');
    const recommendedAudit = auditEvents.find((e) => e.eventType === 'diagnosis_recommended');
    expect(progressAudit).toBeDefined();
    expect(recommendedAudit).toBeDefined();
  });

  it('starts product diagnosis from null diagnosisContext and asks purpose', async () => {
    const sessionRes = await request(app.getHttpServer())
      .post('/api/v1/chat/sessions')
      .send({ language: 'zh-TW' })
      .expect(201);

    const sessionToken = sessionRes.body.data.sessionToken as string;

    const messageRes = await request(app.getHttpServer())
      .post(`/api/v1/chat/sessions/${sessionToken}/messages`)
      .send({ message: '我需要幫我推薦合適的螺絲' })
      .expect(201);

    const done = parseSseDonePayload(messageRes.text);
    expect(messageRes.text).toContain('請問您的用途是什麼？');
    expect(done).not.toBeNull();
    expect(done?.intentLabel).toBe('product-diagnosis');
    expect(done?.sourceReferences).toEqual([]);
    expect((done?.usage as AnyRecord).totalTokens).toBe(0);

    expect(retrievalCalls.length).toBe(0);
    expect(llmMock.stream).toHaveBeenCalledTimes(0);

    const storedConversation = mockPrisma._debug.getConversationByToken(sessionToken) as AnyRecord;
    expect(storedConversation).toBeTruthy();
    const diagnosisContext = storedConversation.diagnosisContext as AnyRecord;
    expect(diagnosisContext.stage).toBe('collecting');
    expect(diagnosisContext.currentField).toBe('purpose');

    const progressAudit = auditEvents.find((e) => e.eventType === 'diagnosis_progress');
    expect(progressAudit).toBeDefined();
  });

  it('high-intent boundary and price-inquiry leadPrompted behavior works and does not auto-create lead/ticket', async () => {
    const baselineLeadCount = mockPrisma._debug.getLeadCount();
    const baselineTicketCount = mockPrisma._debug.getTicketCount();

    const sessionRes = await request(app.getHttpServer())
      .post('/api/v1/chat/sessions')
      .send({ language: 'zh-TW' })
      .expect(201);
    const token = sessionRes.body.data.sessionToken as string;

    const sendAndGetDone = async (message: string) => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/chat/sessions/${token}/messages`)
        .send({ message })
        .expect(201);
      return parseSseDonePayload(res.text);
    };

    const done1 = await sendAndGetDone('請先介紹產品規格');
    expect(done1?.leadPrompted).toBeFalsy();

    const done2 = await sendAndGetDone('可以先給我報價嗎');
    expect(done2?.leadPrompted).toBeFalsy();

    const done3 = await sendAndGetDone('另外想知道多少錢');
    expect(done3?.leadPrompted).toBe(true);

    const sessionRes2 = await request(app.getHttpServer())
      .post('/api/v1/chat/sessions')
      .send({ language: 'zh-TW' })
      .expect(201);
    const token2 = sessionRes2.body.data.sessionToken as string;

    const directPrice = await request(app.getHttpServer())
      .post(`/api/v1/chat/sessions/${token2}/messages`)
      .send({ message: '請問這個產品多少錢？' })
      .expect(201);
    const donePrice = parseSseDonePayload(directPrice.text);
    expect(donePrice?.leadPrompted).toBe(true);

    expect(mockPrisma._debug.getLeadCount()).toBe(baselineLeadCount);
    expect(mockPrisma._debug.getTicketCount()).toBe(baselineTicketCount);

    const responseAudit = auditEvents.find((e) => e.eventType === 'chat_response');
    expect(responseAudit).toBeDefined();
  });

  it('SummaryService supports llm success and fallback with audit logs', async () => {
    const summaryService = app.get(SummaryService);

    const messages = [
      {
        id: 1,
        conversationId: 1,
        role: 'user',
        content: '我想要戶外用不鏽鋼螺絲，請報價',
        type: 'text',
        riskLevel: null,
        blockedReason: null,
        createdAt: new Date(),
      },
    ];

    const successSummary = await summaryService.generate(messages as never, 'zh-TW', {
      sessionId: 's-1',
      requestId: 'r-1',
    });
    expect(successSummary).toBe('這是摘要');
    const generatedAudit = auditEvents.find((e) => e.eventType === 'summary_generated');
    expect(generatedAudit).toBeDefined();

    llmMock.chat.mockRejectedValueOnce(new Error('llm unavailable'));
    let fallbackSummary = '';
    await expect(
      (async () => {
        fallbackSummary = await summaryService.generate(messages as never, 'zh-TW', {
          sessionId: 's-2',
          requestId: 'r-2',
        });
      })(),
    ).resolves.toBeUndefined();

    expect(fallbackSummary).toContain('使用者近期提到');
    const fallbackAudit = auditEvents.find((e) => e.eventType === 'summary_fallback');
    expect(fallbackAudit).toBeDefined();
  });

  it('prompts lead capture when highIntent reaches threshold even if intent is not price-inquiry', async () => {
    const baselineLeadCount = mockPrisma._debug.getLeadCount();
    const baselineTicketCount = mockPrisma._debug.getTicketCount();

    const originalDetect = intentMock.detect.getMockImplementation();
    intentMock.detect.mockImplementation(async () => ({
      intentLabel: 'general-faq',
      confidence: 0.8,
      language: 'zh-TW',
    }));

    try {
      const sessionRes = await request(app.getHttpServer())
        .post('/api/v1/chat/sessions')
        .send({ language: 'zh-TW' })
        .expect(201);
      const token = sessionRes.body.data.sessionToken as string;

      const sendAndGetDone = async (message: string) => {
        const res = await request(app.getHttpServer())
          .post(`/api/v1/chat/sessions/${token}/messages`)
          .send({ message })
          .expect(201);
        return parseSseDonePayload(res.text);
      };

      const done1 = await sendAndGetDone('我想先了解產品規格');
      expect(done1?.leadPrompted).toBeFalsy();

      const done2 = await sendAndGetDone('後續可能需要報價');
      expect(done2?.leadPrompted).toBeFalsy();

      const done3 = await sendAndGetDone('也想詢價');
      expect(done3?.leadPrompted).toBe(true);
      expect(done3?.intentLabel).toBe('general-faq');

      const lastDetectResultPromise = (intentMock.detect as jest.Mock).mock.results.at(-1)
        ?.value as Promise<AnyRecord> | undefined;
      expect(lastDetectResultPromise).toBeDefined();
      await expect(lastDetectResultPromise).resolves.toMatchObject({ intentLabel: 'general-faq' });

      expect(mockPrisma._debug.getLeadCount()).toBe(baselineLeadCount);
      expect(mockPrisma._debug.getTicketCount()).toBe(baselineTicketCount);

      const chatResponseAudit = [...auditEvents]
        .reverse()
        .find((e) => e.eventType === 'chat_response');
      expect(chatResponseAudit).toBeDefined();
      const eventData = (chatResponseAudit?.eventData ?? {}) as AnyRecord;
      expect(eventData.leadPrompted).toBe(true);
      expect((eventData.highIntentScore as number) >= 2).toBe(true);
      expect(Array.isArray(eventData.matchedHighIntentKeywords)).toBe(true);
      expect((eventData.matchedHighIntentKeywords as unknown[]).length).toBeGreaterThan(0);
    } finally {
      if (originalDetect) {
        intentMock.detect.mockImplementation(originalDetect);
      }
    }
  });
});
