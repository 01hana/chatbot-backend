import { describe, beforeEach, it, expect, jest } from '@jest/globals';
import { HybridRetrievalService } from './hybrid-retrieval.service.js';
import { KeywordRetriever } from './retrievers/keyword.retriever.js';
import type { IVectorRetriever } from './retrievers/vector.retriever.interface.js';
import type { IGraphRetriever } from './retrievers/graph.retriever.interface.js';
import { RetrievalFusionService } from './fusion/retrieval-fusion.service.js';
import { RerankerService } from './fusion/reranker.service.js';
import type { ChunkResult } from './types/chunk-result.type.js';
import type { RetrievalPlan } from '../query-understanding/types/retrieval-plan.type.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeChunk(id: number, score: number, content = `content-${id}`): ChunkResult {
  return {
    knowledgeEntryId: id,
    sourceKey: `key-${id}`,
    content,
    score,
    language: 'zh-TW',
  };
}

function makePlan(searchTerms = ['螺絲'], maxResults = 5): RetrievalPlan {
  return { searchTerms, strategies: ['keyword'], maxResults, language: 'zh-TW' };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('HybridRetrievalService', () => {
  let service: HybridRetrievalService;

  let mockKeyword: jest.Mocked<KeywordRetriever>;
  let mockVector: jest.Mocked<IVectorRetriever>;
  let mockGraph: jest.Mocked<IGraphRetriever>;
  let fusionService: RetrievalFusionService;
  let rerankerService: RerankerService;

  beforeEach(() => {
    mockKeyword = {
      retrieve: jest.fn<KeywordRetriever['retrieve']>(),
    } as unknown as jest.Mocked<KeywordRetriever>;

    mockVector = {
      retrieve: jest.fn<IVectorRetriever['retrieve']>(),
    } as jest.Mocked<IVectorRetriever>;

    mockGraph = {
      retrieve: jest.fn<IGraphRetriever['retrieve']>(),
    } as jest.Mocked<IGraphRetriever>;

    // Use real fusion + reranker to test end-to-end behaviour
    fusionService = new RetrievalFusionService();
    rerankerService = new RerankerService();

    service = new HybridRetrievalService(
      mockKeyword,
      mockVector,
      mockGraph,
      fusionService,
      rerankerService,
    );
  });

  // ── V1 baseline behaviour ─────────────────────────────────────────────────

  it('returns keyword results when vector and graph stubs return []', async () => {
    const plan = makePlan();
    mockKeyword.retrieve.mockResolvedValue([makeChunk(1, 0.8), makeChunk(2, 0.6)]);
    mockVector.retrieve.mockResolvedValue([]);
    mockGraph.retrieve.mockResolvedValue([]);

    const results = await service.retrieve(plan, 5);

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.knowledgeEntryId)).toEqual(
      expect.arrayContaining([1, 2]),
    );
  });

  it('returns [] when all retrievers return []', async () => {
    const plan = makePlan();
    mockKeyword.retrieve.mockResolvedValue([]);
    mockVector.retrieve.mockResolvedValue([]);
    mockGraph.retrieve.mockResolvedValue([]);

    const results = await service.retrieve(plan, 5);

    expect(results).toEqual([]);
  });

  // ── Parallel execution ────────────────────────────────────────────────────

  it('calls all three retrievers in parallel (all are called)', async () => {
    const plan = makePlan();
    mockKeyword.retrieve.mockResolvedValue([]);
    mockVector.retrieve.mockResolvedValue([]);
    mockGraph.retrieve.mockResolvedValue([]);

    await service.retrieve(plan, 5);

    expect(mockKeyword.retrieve).toHaveBeenCalledTimes(1);
    expect(mockVector.retrieve).toHaveBeenCalledTimes(1);
    expect(mockGraph.retrieve).toHaveBeenCalledTimes(1);
  });

  it('passes plan to keywordRetriever.retrieve', async () => {
    const plan = makePlan(['M3', 'M4']);
    mockKeyword.retrieve.mockResolvedValue([]);
    mockVector.retrieve.mockResolvedValue([]);
    mockGraph.retrieve.mockResolvedValue([]);

    await service.retrieve(plan, 5);

    expect(mockKeyword.retrieve).toHaveBeenCalledWith(plan);
  });

  it('passes plan and limit to vector/graph retrievers', async () => {
    const plan = makePlan();
    mockKeyword.retrieve.mockResolvedValue([]);
    mockVector.retrieve.mockResolvedValue([]);
    mockGraph.retrieve.mockResolvedValue([]);

    await service.retrieve(plan, 7);

    expect(mockVector.retrieve).toHaveBeenCalledWith(plan, 7);
    expect(mockGraph.retrieve).toHaveBeenCalledWith(plan, 7);
  });

  // ── limit enforcement ─────────────────────────────────────────────────────

  it('slices results to the given limit', async () => {
    const plan = makePlan(['螺絲']);
    mockKeyword.retrieve.mockResolvedValue([
      makeChunk(1, 0.9),
      makeChunk(2, 0.8),
      makeChunk(3, 0.7),
      makeChunk(4, 0.6),
      makeChunk(5, 0.5),
    ]);
    mockVector.retrieve.mockResolvedValue([]);
    mockGraph.retrieve.mockResolvedValue([]);

    const results = await service.retrieve(plan, 3);

    expect(results).toHaveLength(3);
  });

  it('returns all results when count is below limit', async () => {
    const plan = makePlan();
    mockKeyword.retrieve.mockResolvedValue([makeChunk(1, 0.9), makeChunk(2, 0.5)]);
    mockVector.retrieve.mockResolvedValue([]);
    mockGraph.retrieve.mockResolvedValue([]);

    const results = await service.retrieve(plan, 10);

    expect(results).toHaveLength(2);
  });

  // ── Deduplication via fusion ──────────────────────────────────────────────

  it('deduplicates entries that appear in multiple retrievers', async () => {
    const plan = makePlan();
    mockKeyword.retrieve.mockResolvedValue([makeChunk(1, 0.6)]);
    mockVector.retrieve.mockResolvedValue([makeChunk(1, 0.9)]); // same entry, higher score
    mockGraph.retrieve.mockResolvedValue([]);

    const results = await service.retrieve(plan, 5);

    expect(results).toHaveLength(1);
    expect(results[0].score).toBeGreaterThanOrEqual(0.9); // reranked score may be ≥ 0.9
  });

  // ── Sorting (reranker applied) ────────────────────────────────────────────

  it('returns results sorted by score descending after reranking', async () => {
    const plan = makePlan(['螺絲']);
    // Content with matching term gets a bonus
    mockKeyword.retrieve.mockResolvedValue([
      makeChunk(1, 0.5, '無關內容'),
      makeChunk(2, 0.6, '螺絲規格'),
    ]);
    mockVector.retrieve.mockResolvedValue([]);
    mockGraph.retrieve.mockResolvedValue([]);

    const results = await service.retrieve(plan, 5);

    // entry 2 has 0.6 + 0.03 = 0.63; entry 1 has 0.5 — entry 2 first
    expect(results[0].knowledgeEntryId).toBe(2);
    expect(results[1].knowledgeEntryId).toBe(1);
  });

  // ── Pipeline integrity ────────────────────────────────────────────────────

  it('applies both fusion and reranker (integration with real implementations)', async () => {
    const plan = makePlan(['bolt']);
    // keyword returns two entries
    mockKeyword.retrieve.mockResolvedValue([
      makeChunk(10, 0.4, 'a bolt product'),
      makeChunk(11, 0.7, 'another item'),
    ]);
    mockVector.retrieve.mockResolvedValue([]);
    mockGraph.retrieve.mockResolvedValue([]);

    const results = await service.retrieve(plan, 5);

    // entry 10 matched 'bolt' → 0.4 + 0.03 = 0.43
    // entry 11 no match      → 0.7
    // entry 11 should rank first
    expect(results[0].knowledgeEntryId).toBe(11);
    expect(results[1].knowledgeEntryId).toBe(10);
  });
});
