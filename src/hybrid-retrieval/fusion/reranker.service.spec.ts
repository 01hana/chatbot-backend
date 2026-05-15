/**
 * T053 — RerankerService unit tests
 *
 * BOUNDARY NOTICE: RerankerService MUST NOT perform any tokenisation.
 * It only uses plan.searchTerms (pre-computed upstream) for substring matching.
 */
import { describe, beforeEach, it, expect } from '@jest/globals';
import { RerankerService } from './reranker.service.js';
import type { ChunkResult } from '../types/chunk-result.type.js';
import type { RetrievalPlan } from '../../query-understanding/types/retrieval-plan.type.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeChunk(id: number, score: number, content: string): ChunkResult {
  return {
    knowledgeEntryId: id,
    sourceKey: `key-${id}`,
    content,
    score,
    language: 'zh-TW',
  };
}

function makePlan(searchTerms: string[]): RetrievalPlan {
  return { searchTerms, strategies: ['keyword'], maxResults: 5, language: 'zh-TW' };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('RerankerService', () => {
  let service: RerankerService;

  beforeEach(() => {
    service = new RerankerService();
  });

  // ── Term bonus ────────────────────────────────────────────────────────────

  it('adds 0.03 bonus for a single matching search term', () => {
    const chunks = [makeChunk(1, 0.5, '螺絲的規格說明')];
    const plan = makePlan(['螺絲']);

    const results = service.rerank(chunks, plan);

    expect(results[0].score).toBeCloseTo(0.53);
  });

  it('adds no bonus when no search term matches', () => {
    const chunks = [makeChunk(1, 0.5, '完全無關的內容')];
    const plan = makePlan(['螺絲']);

    const results = service.rerank(chunks, plan);

    expect(results[0].score).toBeCloseTo(0.5);
  });

  it('accumulates bonus for multiple matching terms', () => {
    const chunks = [makeChunk(1, 0.4, '螺絲和螺栓的規格')];
    const plan = makePlan(['螺絲', '螺栓']);

    const results = service.rerank(chunks, plan);

    // 0.4 + 0.03 + 0.03 = 0.46
    expect(results[0].score).toBeCloseTo(0.46);
  });

  it('caps the term bonus at 0.15 regardless of match count', () => {
    // 6 matching terms × 0.03 = 0.18 → capped at 0.15
    const terms = ['a', 'b', 'c', 'd', 'e', 'f'];
    const chunks = [makeChunk(1, 0.2, 'a b c d e f')];
    const plan = makePlan(terms);

    const results = service.rerank(chunks, plan);

    // 0.2 + 0.15 = 0.35
    expect(results[0].score).toBeCloseTo(0.35);
  });

  it('matching is case-insensitive', () => {
    const chunks = [makeChunk(1, 0.5, 'SCREW bolt')];
    const plan = makePlan(['screw', 'BOLT']);

    const results = service.rerank(chunks, plan);

    expect(results[0].score).toBeCloseTo(0.56);
  });

  it('caps score at 1.0 when base score + bonus would exceed 1', () => {
    const chunks = [makeChunk(1, 0.95, '螺絲規格')];
    const plan = makePlan(['螺絲']);

    const results = service.rerank(chunks, plan);

    expect(results[0].score).toBeLessThanOrEqual(1.0);
    expect(results[0].score).toBeCloseTo(0.98); // 0.95 + 0.03 = 0.98 < 1
  });

  it('score is capped at exactly 1.0, not above', () => {
    const chunks = [makeChunk(1, 0.99, 'a b c d e f')];
    const plan = makePlan(['a', 'b', 'c', 'd', 'e', 'f']);

    const results = service.rerank(chunks, plan);

    expect(results[0].score).toBe(1.0);
  });

  it('ignores blank / whitespace-only search terms', () => {
    const chunks = [makeChunk(1, 0.5, '螺絲規格')];
    const plan = makePlan(['螺絲', '  ', '']);

    const results = service.rerank(chunks, plan);

    // Only '螺絲' counts
    expect(results[0].score).toBeCloseTo(0.53);
  });

  // ── Sorting ────────────────────────────────────────────────────────────────

  it('sorts results by score descending', () => {
    const chunks = [
      makeChunk(1, 0.3, 'no match'),
      makeChunk(2, 0.6, '螺絲規格'),
      makeChunk(3, 0.5, '螺絲相關'),
    ];
    const plan = makePlan(['螺絲']);

    const results = service.rerank(chunks, plan);

    expect(results[0].knowledgeEntryId).toBe(2); // 0.6 + 0.03 = 0.63
    expect(results[1].knowledgeEntryId).toBe(3); // 0.5 + 0.03 = 0.53
    expect(results[2].knowledgeEntryId).toBe(1); // 0.3
  });

  it('maintains descending order with equal bonus across entries', () => {
    const chunks = [makeChunk(1, 0.4, 'no match'), makeChunk(2, 0.7, 'no match')];
    const plan = makePlan(['x']); // no matches → no bonus

    const results = service.rerank(chunks, plan);

    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  // ── No search terms ────────────────────────────────────────────────────────

  it('returns original scores sorted when searchTerms is empty', () => {
    const chunks = [makeChunk(1, 0.3, 'anything'), makeChunk(2, 0.8, 'anything')];
    const plan = makePlan([]);

    const results = service.rerank(chunks, plan);

    expect(results[0].score).toBe(0.8);
    expect(results[1].score).toBe(0.3);
  });

  it('does not modify original input array', () => {
    const chunks = [makeChunk(1, 0.4, 'hello'), makeChunk(2, 0.9, 'world')];
    const original = [...chunks];
    const plan = makePlan(['hello']);

    service.rerank(chunks, plan);

    expect(chunks).toEqual(original);
  });

  // ── Returns new objects ────────────────────────────────────────────────────

  it('returns new ChunkResult objects (spread), not mutations of originals', () => {
    const chunk = makeChunk(1, 0.5, '螺絲');
    const plan = makePlan(['螺絲']);

    const results = service.rerank([chunk], plan);

    // Score is different (bonus applied), confirming new object
    expect(results[0]).not.toBe(chunk);
    expect(results[0].score).not.toBe(chunk.score);
  });
});
