import { describe, beforeEach, it, expect } from '@jest/globals';
import { RetrievalDecisionService } from './retrieval-decision.service.js';
import type { ChunkResult } from '../types/chunk-result.type.js';
import type { QueryUnderstandingResult } from '../../query-understanding/types/query-understanding-result.type.js';
import type { RetrievalResult } from '../../retrieval/types/retrieval.types.js';
import { TokenType } from '../../query-understanding/types/token-type.enum.js';
import { QueryType } from '../../query-understanding/types/query-type.enum.js';

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

function makeResult(id: number, score: number): RetrievalResult {
  return {
    entry: {
      id,
      content: `content-${id}`,
      sourceKey: `key-${id}`,
      language: 'zh-TW',
    } as RetrievalResult['entry'],
    score,
  };
}

function makeUnderstanding(
  supportability: 'supported' | 'unsupported' | 'unknown' = 'supported',
  opts: {
    unsupportedReason?: string;
    tokens?: { tokenType: TokenType }[];
  } = {},
): QueryUnderstandingResult {
  return {
    rawQuery: '螺絲規格',
    normalizedQuery: '螺絲規格',
    language: 'zh-TW',
    tokenizer: 'rule-based',
    tokens: (opts.tokens ?? [
      { text: '螺絲', normalizedText: '螺絲', tokenType: TokenType.Product, weight: 0.9, source: 'rule-based' },
    ]) as QueryUnderstandingResult['tokens'],
    keyPhrases: [],
    queryType: QueryType.ProductLookup,
    supportability,
    unsupportedReason: opts.unsupportedReason,
    retrievalPlan: { searchTerms: ['螺絲'], strategies: ['keyword'], maxResults: 5, language: 'zh-TW' },
    debugMeta: { durationMs: 1, tokenizerUsed: 'rule-based', timestamp: new Date().toISOString() },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('RetrievalDecisionService', () => {
  let service: RetrievalDecisionService;

  beforeEach(() => {
    service = new RetrievalDecisionService();
  });

  // ────────────────────────────────────────────────────────────────────────
  // Hybrid path — decideFromChunks
  // ────────────────────────────────────────────────────────────────────────

  describe('decideFromChunks (hybrid path)', () => {
    it('returns canAnswer=false, reason=no_results when chunks is empty', () => {
      const decision = service.decideFromChunks([], undefined, 0.5);

      expect(decision.canAnswer).toBe(false);
      expect(decision.reason).toBe('no_results');
      expect(decision.confidence).toBe(0);
      expect(decision.topK).toEqual([]);
    });

    it('returns canAnswer=false, reason=low_score when top score < minScore', () => {
      const chunks = [makeChunk(1, 0.3), makeChunk(2, 0.2)];
      const decision = service.decideFromChunks(chunks, undefined, 0.5);

      expect(decision.canAnswer).toBe(false);
      expect(decision.reason).toBe('low_score');
      expect(decision.confidence).toBeCloseTo(0.3);
    });

    it('returns canAnswer=false when top score equals minScore threshold (exclusive)', () => {
      // top score = 0.5 exactly: 0.5 < 0.5 is false → should pass (canAnswer=true when nothing else blocks)
      const chunks = [makeChunk(1, 0.5)];
      const decision = service.decideFromChunks(chunks, undefined, 0.5);

      // score is NOT less than minScore, so low_score does not trigger
      expect(decision.reason).not.toBe('low_score');
    });

    it('returns canAnswer=false, reason=unsupported when supportability=unsupported', () => {
      const chunks = [makeChunk(1, 0.8)];
      const ur = makeUnderstanding('unsupported', { unsupportedReason: 'no_kb_content' });
      const decision = service.decideFromChunks(chunks, ur, 0.3);

      expect(decision.canAnswer).toBe(false);
      expect(decision.reason).toBe('unsupported'); // 'no_kb_content' not in known list → 'unsupported'
    });

    it('uses unsupportedReason directly when it is a known reason code', () => {
      const chunks = [makeChunk(1, 0.8)];
      const ur = makeUnderstanding('unsupported', { unsupportedReason: 'unknown_query_type' });
      const decision = service.decideFromChunks(chunks, ur, 0.3);

      expect(decision.canAnswer).toBe(false);
      expect(decision.reason).toBe('unknown_query_type');
    });

    it('returns reason=all_tokens_noise when unsupportedReason=all_tokens_noise', () => {
      const chunks = [makeChunk(1, 0.8)];
      const ur = makeUnderstanding('unsupported', { unsupportedReason: 'all_tokens_noise' });
      const decision = service.decideFromChunks(chunks, ur, 0.3);

      expect(decision.canAnswer).toBe(false);
      expect(decision.reason).toBe('all_tokens_noise');
    });

    it('returns reason=all_tokens_noise when all tokens are Noise type', () => {
      const chunks = [makeChunk(1, 0.8)];
      const ur = makeUnderstanding('unknown', {
        tokens: [
          { tokenType: TokenType.Noise },
          { tokenType: TokenType.Noise },
        ],
      });
      const decision = service.decideFromChunks(chunks, ur, 0.3);

      expect(decision.canAnswer).toBe(false);
      expect(decision.reason).toBe('all_tokens_noise');
    });

    it('does not trigger all_tokens_noise when tokens list is empty', () => {
      const chunks = [makeChunk(1, 0.8)];
      const ur = makeUnderstanding('supported', { tokens: [] });
      const decision = service.decideFromChunks(chunks, ur, 0.3);

      // empty tokens: allNoise guard requires length > 0
      expect(decision.canAnswer).toBe(true);
      expect(decision.reason).toBe('ok');
    });

    it('returns canAnswer=true, reason=ok for normal supported results', () => {
      const chunks = [makeChunk(1, 0.8), makeChunk(2, 0.6)];
      const ur = makeUnderstanding('supported');
      const decision = service.decideFromChunks(chunks, ur, 0.3);

      expect(decision.canAnswer).toBe(true);
      expect(decision.reason).toBe('ok');
    });

    it('confidence equals the top score', () => {
      const chunks = [makeChunk(1, 0.4), makeChunk(2, 0.9), makeChunk(3, 0.7)];
      const decision = service.decideFromChunks(chunks, undefined, 0.3);

      expect(decision.confidence).toBeCloseTo(0.9);
    });

    it('topK is sorted by score descending', () => {
      const chunks = [makeChunk(1, 0.4), makeChunk(2, 0.9), makeChunk(3, 0.7)];
      const decision = service.decideFromChunks(chunks, undefined, 0.3);

      expect(decision.topK[0].score).toBe(0.9);
      expect(decision.topK[1].score).toBe(0.7);
      expect(decision.topK[2].score).toBe(0.4);
    });

    it('does not mutate the original chunks array', () => {
      const chunks = [makeChunk(1, 0.4), makeChunk(2, 0.9)];
      const original = [...chunks];
      service.decideFromChunks(chunks, undefined, 0.3);

      expect(chunks).toEqual(original);
    });

    // ── understandingResult=undefined ────────────────────────────────────────

    it('only uses score-based checks when understandingResult is undefined', () => {
      const chunks = [makeChunk(1, 0.8)];
      const decision = service.decideFromChunks(chunks, undefined, 0.3);

      expect(decision.canAnswer).toBe(true);
      expect(decision.reason).toBe('ok');
    });

    it('returns no_results with undefined understandingResult when chunks empty', () => {
      const decision = service.decideFromChunks([], undefined, 0.5);

      expect(decision.canAnswer).toBe(false);
      expect(decision.reason).toBe('no_results');
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Legacy path — decideFromRetrievalResults
  // ────────────────────────────────────────────────────────────────────────

  describe('decideFromRetrievalResults (legacy path)', () => {
    it('returns canAnswer=false when results is empty', () => {
      const decision = service.decideFromRetrievalResults([], undefined, 0.5);

      expect(decision.canAnswer).toBe(false);
      expect(decision.reason).toBe('no_results');
    });

    it('returns canAnswer=false when top score < minScore', () => {
      const results = [makeResult(1, 0.2), makeResult(2, 0.1)];
      const decision = service.decideFromRetrievalResults(results, undefined, 0.5);

      expect(decision.canAnswer).toBe(false);
      expect(decision.reason).toBe('low_score');
    });

    it('returns canAnswer=true for passing results without understandingResult', () => {
      const results = [makeResult(1, 0.8), makeResult(2, 0.6)];
      const decision = service.decideFromRetrievalResults(results, undefined, 0.3);

      expect(decision.canAnswer).toBe(true);
      expect(decision.reason).toBe('ok');
    });

    it('converts RetrievalResult to ChunkResult correctly', () => {
      const results = [makeResult(99, 0.75)];
      const decision = service.decideFromRetrievalResults(results, undefined, 0.3);

      expect(decision.topK).toHaveLength(1);
      expect(decision.topK[0].knowledgeEntryId).toBe(99);
      expect(decision.topK[0].score).toBe(0.75);
      expect(decision.topK[0].sourceKey).toBe('key-99');
      expect(decision.topK[0].content).toBe('content-99');
      expect(decision.topK[0].language).toBe('zh-TW');
    });

    it('applies understandingResult checks on legacy path', () => {
      const results = [makeResult(1, 0.8)];
      const ur = makeUnderstanding('unsupported', { unsupportedReason: 'all_tokens_noise' });
      const decision = service.decideFromRetrievalResults(results, ur, 0.3);

      expect(decision.canAnswer).toBe(false);
      expect(decision.reason).toBe('all_tokens_noise');
    });

    it('only uses score checks when understandingResult is undefined', () => {
      const results = [makeResult(1, 0.9)];
      const decision = service.decideFromRetrievalResults(results, undefined, 0.5);

      expect(decision.canAnswer).toBe(true);
    });

    it('handles null sourceKey from RetrievalResult entry', () => {
      const r = makeResult(1, 0.7);
      (r.entry as { sourceKey: string | null }).sourceKey = null;
      const decision = service.decideFromRetrievalResults([r], undefined, 0.3);

      expect(decision.topK[0].sourceKey).toBe('');
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Evaluate order (priority verification)
  // ────────────────────────────────────────────────────────────────────────

  describe('evaluate priority order', () => {
    it('no_results takes priority over everything (empty chunks always no_results)', () => {
      const ur = makeUnderstanding('unsupported', { unsupportedReason: 'all_tokens_noise' });
      const decision = service.decideFromChunks([], ur, 0.3);

      expect(decision.reason).toBe('no_results'); // not all_tokens_noise
    });

    it('low_score takes priority over unsupported', () => {
      const chunks = [makeChunk(1, 0.1)];
      const ur = makeUnderstanding('unsupported', { unsupportedReason: 'no_kb_content' });
      const decision = service.decideFromChunks(chunks, ur, 0.5);

      expect(decision.reason).toBe('low_score'); // not unsupported
    });
  });
});
