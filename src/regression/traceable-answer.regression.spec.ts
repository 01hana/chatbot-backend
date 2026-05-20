/**
 * traceable-answer.regression.spec.ts — Traceable Answer regression baseline (Phase 6-C)
 *
 * 「測試範圍」
 * - T081-1: feature.traceable_answer_enabled=true → trace present in AuditLog
 *             trace.totalMs, trace.queryUnderstandingMs, trace.llmMs are numbers
 *             trace.chunkDetails[i] has score + retriever, but NO content field
 *             SSE done payload does NOT contain trace (backend-only field)
 * - T081-2: feature.traceable_answer_enabled=false (default) → trace absent
 *             sourceReferences still present in SSE done and AuditLog
 * - T081-3: 003 hybrid path + feature.audit_verbose_enabled=false (default)
 *             audit.queryUnderstanding is slim (no rawQuery, no tokens array)
 *             audit.retrievalCandidates is slim (no content field per chunk)
 *
 * 「測試策略（無 DB / 無 actual LLM）」
 * - ChatPipelineService: real implementation via NestJS TestingModule
 * - All dependencies: mocked (same pattern as chat-pipeline.service.spec.ts)
 * - LLM stream: fast async generator mock, no real HTTP calls
 * - AuditService: mock that captures log() calls for assertion
 *
 * Baseline: 2026-05-18 (Phase 6-C, T081)
 */

import { Test } from '@nestjs/testing';
import { Response } from 'express';
import { describe, beforeEach, afterEach, it, expect } from '@jest/globals';
import { ChatPipelineService } from '../chat/chat-pipeline.service';
import { SafetyService } from '../safety/safety.service';
import { IntentService } from '../intent/intent.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { AuditService } from '../audit/audit.service';
import { ConversationService } from '../conversation/conversation.service';
import { AiStatusService } from '../health/ai-status.service';
import { PromptBuilder } from '../chat/prompt-builder';
import { LLM_PROVIDER } from '../llm/interfaces/llm-provider.interface';
import { RETRIEVAL_SERVICE } from '../retrieval/interfaces/retrieval-service.interface';
import { QueryAnalysisService } from '../query-analysis/query-analysis.service';
import { AnswerTemplateResolver } from '../template/answer-template-resolver';
import { QueryUnderstandingService } from '../query-understanding/query-understanding.service';
import { HybridRetrievalService } from '../hybrid-retrieval/hybrid-retrieval.service';
import { RetrievalDecisionService } from '../hybrid-retrieval/gate/retrieval-decision.service';
import { QueryType } from '../query-understanding/types/query-type.enum';
import type { KnowledgeEntry } from '../generated/prisma/client';
import type { RetrievalResult } from '../retrieval/types/retrieval.types';
import type { ChunkResult } from '../hybrid-retrieval/types/chunk-result.type';
import type { QueryUnderstandingResult } from '../query-understanding/types/query-understanding-result.type';

// ── Shared mock helpers ───────────────────────────────────────────────────────

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

const makeRetrievalResult = (
  score: number,
  entryOverrides: Partial<KnowledgeEntry> = {},
): RetrievalResult => ({
  entry: makeKnowledgeEntry(entryOverrides),
  score,
});

/** LLM stream mock: yields one token then a done chunk. */
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

/** A ChunkResult with a high relevance score for the 003 hybrid path. */
const makeTestChunk = (): ChunkResult => ({
  knowledgeEntryId: 200,
  sourceKey: 'bh-regression',
  content: '公司上班時間：週一至週五 08:30–17:30',
  score: 0.85,
  language: 'zh-TW',
});

/**
 * A mock QueryUnderstandingResult with explicit debugMeta.durationMs.
 * Required for trace.queryUnderstandingMs to be populated in T081-1.
 */
const makeQUMockResult = (): QueryUnderstandingResult => ({
  rawQuery: '上班時間查詢',
  normalizedQuery: '上班時間查詢',
  language: 'zh-TW',
  tokenizer: 'rule-based',
  tokens: [],
  keyPhrases: [],
  queryType: QueryType.BusinessHours,
  supportability: 'supported',
  retrievalPlan: {
    searchTerms: ['上班時間'],
    strategies: ['keyword'],
    maxResults: 5,
    language: 'zh-TW',
  },
  debugMeta: {
    durationMs: 5,
    tokenizerUsed: 'rule-based',
    timestamp: new Date().toISOString(),
  },
});

// ── SSE / audit helpers ───────────────────────────────────────────────────────

/** Parse the first `event: done` payload from SSE writes. */
const parseDonePayload = (
  res: jest.Mocked<Partial<Response>>,
): Record<string, unknown> | undefined => {
  const raw = (res.write as jest.Mock).mock.calls
    .map((c: unknown[]) => c[0] as string)
    .join('');
  for (const block of raw.split('\n\n').filter(Boolean)) {
    const lines = block.split('\n');
    if (lines.some((l) => l.startsWith('event:') && l.includes('done'))) {
      const dataLine = lines.find((l) => l.startsWith('data:'));
      if (dataLine)
        return JSON.parse(dataLine.replace(/^data:\s*/, '')) as Record<string, unknown>;
    }
  }
  return undefined;
};

/** Return the first `chat_response` audit log call argument, or undefined. */
const getChatResponseAuditArg = (
  mockAuditService: { log: jest.Mock },
): Record<string, unknown> | undefined => {
  const call = (mockAuditService.log as jest.Mock).mock.calls.find(
    (args: unknown[]) => (args[0] as { eventType: string }).eventType === 'chat_response',
  );
  return call ? (call[0] as Record<string, unknown>) : undefined;
};

// ── Test suite ────────────────────────────────────────────────────────────────

describe('Traceable Answer Regression (Phase 6-C — T081)', () => {
  let service: ChatPipelineService;

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
  const mockLlmProvider = { stream: jest.fn() };
  const mockRetrievalService = { retrieve: jest.fn().mockResolvedValue([]) };
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

    // Reset all mocks to safe defaults
    jest.clearAllMocks();
    mockSafetyService.scanPrompt.mockReturnValue({ blocked: false });
    mockSafetyService.checkConfidentiality.mockReturnValue({ triggered: false });
    mockSafetyService.buildRefusalResponse.mockReturnValue('拒絕');
    mockSafetyService.buildHandoffGuidance.mockReturnValue('請留下聯絡資訊');
    mockIntentService.detect.mockResolvedValue({ label: 'general', score: 0.1, sensitive: false });
    mockSystemConfigService.get.mockReturnValue(null);
    mockSystemConfigService.getBoolean.mockReturnValue(null); // all feature flags OFF
    mockAiStatusService.isDegraded.mockReturnValue(false);
    mockRetrievalService.retrieve.mockResolvedValue([]);
    mockPromptBuilder.build.mockReturnValue({ messages: [], estimatedTokens: 0 });
    mockConversationService.addMessage.mockResolvedValue({ id: 1 });
    mockConversationService.updateConversation.mockResolvedValue({});
    mockConversationService.getHistoryByToken.mockResolvedValue([]);
    mockConversationService.incrementSensitiveIntentCount.mockResolvedValue({
      sensitiveIntentCount: 1,
    });
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
    mockTemplateResolver.resolve.mockReturnValue({ strategy: 'rag', reason: 'rag:default' });
    mockQUS003.understand.mockResolvedValue(null);
    mockHRS003.retrieve.mockResolvedValue([]);
    mockRDS003.decideFromChunks.mockReturnValue(null);
    mockRDS003.decideFromRetrievalResults.mockReturnValue(null);
  });

  afterEach(() => { jest.clearAllMocks(); });

  // ── T081-1: traceable_answer_enabled=true → trace present in AuditLog ──────

  it('T081-1: traceable_answer_enabled=true — trace present in AuditLog with correct shape', async () => {
    mockSystemConfigService.getBoolean.mockImplementation((key: string) => {
      if (key === 'feature.traceable_answer_enabled') return true;
      return null;
    });
    mockRetrievalService.retrieve.mockResolvedValue([
      makeRetrievalResult(0.9, { id: 42, content: '上班時間資訊', sourceKey: 'bh-key' }),
    ]);
    mockLlmProvider.stream.mockReturnValue(makeLlmStream());

    const res = makeRes();
    await service.run(
      makeConversation() as never,
      '上班時間查詢',
      'req-t081-1',
      res as never,
      new AbortController().signal,
    );

    const audit = getChatResponseAuditArg(mockAuditService as { log: jest.Mock });
    expect(audit).toBeDefined();

    // trace must be present when flag=true
    const trace = audit!['trace'] as Record<string, unknown>;
    expect(trace).toBeDefined();
    expect(typeof trace['totalMs']).toBe('number');
    expect(typeof trace['queryUnderstandingMs']).toBe('number');
    expect(typeof trace['retrievalMs']).toBe('number');
    expect(typeof trace['fusionMs']).toBe('number');
    // LLM path: llmMs is set (may be 0 in mock due to instant execution)
    expect(typeof trace['llmMs']).toBe('number');

    // chunkDetails must be present but NOT contain content
    const chunkDetails = trace['chunkDetails'] as Record<string, unknown>[];
    expect(Array.isArray(chunkDetails)).toBe(true);
    expect(chunkDetails.length).toBeGreaterThan(0);
    expect(chunkDetails[0]['content']).toBeUndefined();
    expect(typeof chunkDetails[0]['score']).toBe('number');
    expect(typeof chunkDetails[0]['retriever']).toBe('string');

    // sourceReferences must still be present when trace is enabled
    const auditRefs = audit!['sourceReferences'] as unknown[];
    expect(Array.isArray(auditRefs)).toBe(true);
    expect(auditRefs.length).toBeGreaterThan(0);

    // SSE done payload must NOT contain trace (trace is audit-only, not SSE)
    const done = parseDonePayload(res);
    expect(done).toBeDefined();
    expect(done!['trace']).toBeUndefined();
  });

  // ── T081-2: traceable_answer_enabled=false (default) → trace absent ─────────

  it('T081-2: traceable_answer_enabled=false (default) — trace absent, sourceReferences present', async () => {
    // beforeEach already sets getBoolean → null (all flags OFF)
    mockRetrievalService.retrieve.mockResolvedValue([
      makeRetrievalResult(0.9, { id: 43, content: '業務資訊', sourceKey: 'biz-key' }),
    ]);
    mockLlmProvider.stream.mockReturnValue(makeLlmStream());

    const res = makeRes();
    await service.run(
      makeConversation() as never,
      '業務查詢',
      'req-t081-2',
      res as never,
      new AbortController().signal,
    );

    const audit = getChatResponseAuditArg(mockAuditService as { log: jest.Mock });
    expect(audit).toBeDefined();

    // trace must be absent when flag=false
    expect(audit!['trace']).toBeUndefined();

    // sourceReferences must still be present regardless of trace flag
    const auditRefs = audit!['sourceReferences'] as unknown[];
    expect(Array.isArray(auditRefs)).toBe(true);
    expect(auditRefs.length).toBeGreaterThan(0);

    // SSE done must also have sourceReferences
    const done = parseDonePayload(res);
    expect(done).toBeDefined();
    expect(Array.isArray(done!['sourceReferences'])).toBe(true);
    expect(done!['trace']).toBeUndefined();
  });

  // ── T081-3: 003 hybrid path + audit_verbose_enabled=false → slim audit ──────

  it('T081-3: 003 hybrid path + audit_verbose_enabled=false — slim queryUnderstanding and retrievalCandidates', async () => {
    // Enable the full 003 path; audit_verbose_enabled=false (default null → false)
    mockSystemConfigService.getBoolean.mockImplementation((key: string) => {
      if (key === 'feature.query_understanding_v2_enabled') return true;
      if (key === 'feature.hybrid_retrieval_enabled') return true;
      if (key === 'feature.no_answer_gate_enabled') return true;
      // feature.audit_verbose_enabled is NOT set → remains false
      // feature.traceable_answer_enabled is NOT set → trace absent
      return null;
    });

    const chunk = makeTestChunk();
    mockQUS003.understand.mockResolvedValue(makeQUMockResult());
    mockHRS003.retrieve.mockResolvedValue([chunk]);
    mockRDS003.decideFromChunks.mockReturnValue({
      canAnswer: true,
      reason: 'ok',
      confidence: 0.85,
      topK: [chunk],
    });
    mockLlmProvider.stream.mockReturnValue(makeLlmStream());

    const res = makeRes();
    await service.run(
      makeConversation() as never,
      '上班時間是什麼',
      'req-t081-3',
      res as never,
      new AbortController().signal,
    );

    const audit = getChatResponseAuditArg(mockAuditService as { log: jest.Mock });
    expect(audit).toBeDefined();

    // Slim queryUnderstanding: tokenizer/queryType/supportability/keyPhrases/durationMs only
    // Must NOT contain rawQuery, tokens, normalizedQuery (verbose-only fields)
    const auditQU = audit!['queryUnderstanding'] as Record<string, unknown>;
    expect(auditQU).toBeDefined();
    expect(auditQU['rawQuery']).toBeUndefined();
    expect(auditQU['tokens']).toBeUndefined();
    expect(auditQU['normalizedQuery']).toBeUndefined();
    // Slim fields must be present
    expect(typeof auditQU['tokenizer']).toBe('string');
    expect(typeof auditQU['queryType']).toBe('string');
    expect(typeof auditQU['supportability']).toBe('string');
    expect(Array.isArray(auditQU['keyPhrases'])).toBe(true);
    expect(typeof auditQU['durationMs']).toBe('number');

    // Slim retrievalCandidates: score/sourceKey/language present, content ABSENT
    const auditCandidates = audit!['retrievalCandidates'] as Record<string, unknown>[];
    expect(Array.isArray(auditCandidates)).toBe(true);
    expect(auditCandidates.length).toBeGreaterThan(0);
    expect(auditCandidates[0]['content']).toBeUndefined();
    expect(typeof auditCandidates[0]['score']).toBe('number');
    expect(typeof auditCandidates[0]['language']).toBe('string');

    // trace absent (traceable_answer_enabled not set)
    expect(audit!['trace']).toBeUndefined();
  });

  // ── T081-4: 003 hybrid path + traceable_answer_enabled=true ─────────────────

  it('T081-4: 003 hybrid path + traceable_answer_enabled=true — trace.queryUnderstandingMs from debugMeta', async () => {
    mockSystemConfigService.getBoolean.mockImplementation((key: string) => {
      if (key === 'feature.query_understanding_v2_enabled') return true;
      if (key === 'feature.hybrid_retrieval_enabled') return true;
      if (key === 'feature.no_answer_gate_enabled') return true;
      if (key === 'feature.traceable_answer_enabled') return true;
      return null;
    });

    const chunk = makeTestChunk();
    mockQUS003.understand.mockResolvedValue(makeQUMockResult()); // debugMeta.durationMs = 5
    mockHRS003.retrieve.mockResolvedValue([chunk]);
    mockRDS003.decideFromChunks.mockReturnValue({
      canAnswer: true,
      reason: 'ok',
      confidence: 0.85,
      topK: [chunk],
    });
    mockLlmProvider.stream.mockReturnValue(makeLlmStream());

    const res = makeRes();
    await service.run(
      makeConversation() as never,
      '上班時間是什麼',
      'req-t081-4',
      res as never,
      new AbortController().signal,
    );

    const audit = getChatResponseAuditArg(mockAuditService as { log: jest.Mock });
    expect(audit).toBeDefined();

    // trace must be present
    const trace = audit!['trace'] as Record<string, unknown>;
    expect(trace).toBeDefined();

    // queryUnderstandingMs must come from the mock QU result's debugMeta.durationMs (5)
    expect(trace['queryUnderstandingMs']).toBe(5);
    expect(typeof trace['totalMs']).toBe('number');

    // chunkDetails from hybrid path — retriever label is 'keyword'
    const chunkDetails = trace['chunkDetails'] as Record<string, unknown>[];
    expect(Array.isArray(chunkDetails)).toBe(true);
    if (chunkDetails.length > 0) {
      // content must NOT be present in chunkDetails (security: no raw content in trace)
      expect(chunkDetails[0]['content']).toBeUndefined();
      expect(chunkDetails[0]['retriever']).toBe('keyword');
    }
  });
});
