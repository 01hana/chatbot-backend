/**
 * T051 — KeywordRetriever unit tests
 *
 * BOUNDARY NOTICE (code review acceptance criterion):
 * KeywordRetriever MUST NOT contain any of the following:
 *   - Tokenisation logic
 *   - Stop-word filtering
 *   - Bigram / n-gram expansion
 *   - Domain-signal scoring
 *   - Supportability checks
 * All linguistic analysis is performed upstream by QueryUnderstandingService.
 * The reviewer should verify these are absent from keyword.retriever.ts.
 */
import { describe, beforeEach, it, expect, jest } from '@jest/globals';
import { KeywordRetriever } from './keyword.retriever.js';
import type { IRetrievalService } from '../../retrieval/interfaces/retrieval-service.interface.js';
import type { RetrievalResult } from '../../retrieval/types/retrieval.types.js';
import type { RetrievalPlan } from '../../query-understanding/types/retrieval-plan.type.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makePlan(searchTerms: string[], language = 'zh-TW', maxResults = 5): RetrievalPlan {
  return { searchTerms, strategies: ['keyword'], maxResults, language };
}

function makeResult(id: number, score: number, overrides: Partial<{
  sourceKey: string;
  content: string;
  language: string;
  isCrossLanguageFallback: boolean;
}> = {}): RetrievalResult {
  return {
    entry: {
      id,
      content: overrides.content ?? `content-${id}`,
      sourceKey: overrides.sourceKey ?? `key-${id}`,
      language: overrides.language ?? 'zh-TW',
    } as RetrievalResult['entry'],
    score,
    isCrossLanguageFallback: overrides.isCrossLanguageFallback,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('KeywordRetriever', () => {
  let retriever: KeywordRetriever;
  let mockRetrievalService: jest.Mocked<IRetrievalService>;

  beforeEach(() => {
    mockRetrievalService = {
      retrieve: jest.fn<IRetrievalService['retrieve']>(),
    } as jest.Mocked<IRetrievalService>;

    retriever = new KeywordRetriever(mockRetrievalService);
  });

  // ── Call pattern ──────────────────────────────────────────────────────────

  it('calls retrieve once per search term in order', async () => {
    const plan = makePlan(['螺絲', '螺栓', 'M3']);
    mockRetrievalService.retrieve.mockResolvedValue([]);

    await retriever.retrieve(plan);

    expect(mockRetrievalService.retrieve).toHaveBeenCalledTimes(3);
    expect(mockRetrievalService.retrieve).toHaveBeenNthCalledWith(1, {
      query: '螺絲',
      language: 'zh-TW',
      limit: 5,
    });
    expect(mockRetrievalService.retrieve).toHaveBeenNthCalledWith(2, {
      query: '螺栓',
      language: 'zh-TW',
      limit: 5,
    });
    expect(mockRetrievalService.retrieve).toHaveBeenNthCalledWith(3, {
      query: 'M3',
      language: 'zh-TW',
      limit: 5,
    });
  });

  it('passes plan.maxResults as the limit in each retrieve call', async () => {
    const plan = makePlan(['螺絲'], 'zh-TW', 10);
    mockRetrievalService.retrieve.mockResolvedValue([]);

    await retriever.retrieve(plan);

    expect(mockRetrievalService.retrieve).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10 }),
    );
  });

  it('passes plan.language in each retrieve call', async () => {
    const plan = makePlan(['screw'], 'en', 5);
    mockRetrievalService.retrieve.mockResolvedValue([]);

    await retriever.retrieve(plan);

    expect(mockRetrievalService.retrieve).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'en' }),
    );
  });

  // ── Empty plan ────────────────────────────────────────────────────────────

  it('returns [] and never calls retrieve when searchTerms is empty', async () => {
    const plan = makePlan([]);

    const result = await retriever.retrieve(plan);

    expect(mockRetrievalService.retrieve).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  // ── Deduplication ─────────────────────────────────────────────────────────

  it('deduplicates by knowledgeEntryId, keeping the highest score', async () => {
    const plan = makePlan(['A', 'B']);
    // Term A returns entry 1 with score 0.6
    // Term B returns entry 1 again with score 0.9 (higher) and a new entry 2
    mockRetrievalService.retrieve
      .mockResolvedValueOnce([makeResult(1, 0.6), makeResult(2, 0.4)])
      .mockResolvedValueOnce([makeResult(1, 0.9)]);

    const results = await retriever.retrieve(plan);

    const entry1 = results.find((r) => r.knowledgeEntryId === 1);
    expect(entry1).toBeDefined();
    expect(entry1!.score).toBe(0.9); // higher score retained
    expect(results.filter((r) => r.knowledgeEntryId === 1)).toHaveLength(1); // deduplicated
    expect(results.find((r) => r.knowledgeEntryId === 2)).toBeDefined();
    expect(results).toHaveLength(2);
  });

  it('keeps the lower-scored entry when the second call has a lower score', async () => {
    const plan = makePlan(['A', 'B']);
    mockRetrievalService.retrieve
      .mockResolvedValueOnce([makeResult(1, 0.9)])
      .mockResolvedValueOnce([makeResult(1, 0.5)]);

    const results = await retriever.retrieve(plan);

    expect(results).toHaveLength(1);
    expect(results[0].score).toBe(0.9);
  });

  // ── toChunkResult mapping ─────────────────────────────────────────────────

  it('maps knowledgeEntryId, sourceKey, content, score, and language correctly', async () => {
    const plan = makePlan(['螺絲']);
    mockRetrievalService.retrieve.mockResolvedValueOnce([
      makeResult(42, 0.75, {
        sourceKey: 'screw-faq',
        content: '螺絲規格說明',
        language: 'zh-TW',
      }),
    ]);

    const results = await retriever.retrieve(plan);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      knowledgeEntryId: 42,
      sourceKey: 'screw-faq',
      content: '螺絲規格說明',
      score: 0.75,
      language: 'zh-TW',
    });
  });

  it('falls back sourceKey to empty string when entry.sourceKey is null', async () => {
    const plan = makePlan(['螺絲']);
    const result = makeResult(1, 0.5);
    (result.entry as { sourceKey: string | null }).sourceKey = null;
    mockRetrievalService.retrieve.mockResolvedValueOnce([result]);

    const results = await retriever.retrieve(plan);

    expect(results[0].sourceKey).toBe('');
  });

  it('propagates isCrossLanguageFallback', async () => {
    const plan = makePlan(['screw'], 'en');
    mockRetrievalService.retrieve.mockResolvedValueOnce([
      makeResult(1, 0.5, { isCrossLanguageFallback: true }),
    ]);

    const results = await retriever.retrieve(plan);

    expect(results[0].isCrossLanguageFallback).toBe(true);
  });

  it('does not set chunkId (KnowledgeEntry-based hit in V1)', async () => {
    const plan = makePlan(['螺絲']);
    mockRetrievalService.retrieve.mockResolvedValueOnce([makeResult(1, 0.5)]);

    const results = await retriever.retrieve(plan);

    // ChunkResult returned by V1 KeywordRetriever does not have chunkId
    expect('chunkId' in results[0]).toBe(false);
  });
});
