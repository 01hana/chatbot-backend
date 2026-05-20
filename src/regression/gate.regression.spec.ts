/**
 * gate.regression.spec.ts — No-answer Gate regression baseline (Phase 6-C)
 *
 * 「測試範圍」
 * - T079: domain-out queries → canAnswer=false (no KB content)
 * - T080: business_hours queries → queryType=BusinessHours (NOT QuoteRequest)
 *           Scenario A (no KB): canAnswer=false, reason='no_results'
 *           Scenario B (with KB, score≥0.7): canAnswer=true, reason='ok'
 *           Scenario C (score boundary < 0.7): canAnswer=false, reason='low_score'
 *
 * 「SC-001 regression」
 *   Off-topic queries must never trigger LLM calls when KB has no content.
 *   Unit-level proof: decideFromChunks([], quResult, 0.7).canAnswer === false.
 *
 * 「SC-003 regression」
 *   Business-hours queries (上班時間, 營業, 地址, 工作日) must be classified as
 *   QueryType.BusinessHours, never QueryType.QuoteRequest.
 *   BUSINESS_HOURS_RE is evaluated BEFORE the generic hasBusiness check.
 *
 * 「測試策略（無 DB / 無 LLM）」
 * - QueryUnderstandingService: real implementation
 * - TokenizerProviderService: real implementation, mocked SystemConfigService + JiebaTokenizer
 * - SupportabilityClassifier: mocked → always returns 'supported' (isolates gate logic)
 * - RetrievalDecisionService: direct instantiation (no constructor parameters)
 * - ChunkResult: in-memory stubs, no DB access
 *
 * Baseline: 2026-05-18 (Phase 6-C, T079 + T080)
 */

import { describe, beforeAll, afterEach, it, expect } from '@jest/globals';
import { QueryUnderstandingService } from '../query-understanding/query-understanding.service';
import { TokenizerProviderService } from '../query-understanding/tokenizers/tokenizer-provider.service';
import { SupportabilityClassifier } from '../query-understanding/classifiers/supportability.classifier';
import { JiebaTokenizer } from '../query-understanding/tokenizers/jieba.tokenizer';
import { SystemConfigService } from '../system-config/system-config.service';
import { RetrievalDecisionService } from '../hybrid-retrieval/gate/retrieval-decision.service';
import { QueryType } from '../query-understanding/types/query-type.enum';
import type { ChunkResult } from '../hybrid-retrieval/types/chunk-result.type';
import { DOMAIN_OUT_FIXTURES, BUSINESS_HOURS_FIXTURES } from './fixtures/no-answer-gate.fixture';

// ── Mock helpers (typed for contextual jest.fn() inference) ──────────────────

/**
 * Create a mock SystemConfigService that forces rule-based zh tokenizer.
 * Typed return enables contextual inference for jest.fn().
 */
function makeSystemConfigMock(): SystemConfigService {
  return {
    getString: jest.fn().mockImplementation(
      (key: string, defaultValue: string): string => {
        if (key === 'feature.zh_tokenizer') return 'rule-based';
        return defaultValue;
      },
    ),
  } as unknown as SystemConfigService;
}

/**
 * Create a mock JiebaTokenizer that is always not ready (CI portable).
 */
function makeJiebaMock(): JiebaTokenizer {
  return {
    isReady: jest.fn().mockReturnValue(false),
    tokenize: jest.fn().mockResolvedValue([]),
  } as unknown as JiebaTokenizer;
}

/**
 * Create a mock SupportabilityClassifier that always returns 'supported'.
 * This isolates gate logic from KB availability, letting domain-out queries
 * still reach the gate and be blocked by 'no_results'.
 */
function makeSupportabilityMock(): SupportabilityClassifier {
  return {
    classify: jest.fn().mockResolvedValue({ status: 'supported' }),
  } as unknown as SupportabilityClassifier;
}

// ── Service factories ─────────────────────────────────────────────────────────

function makeQUService(): QueryUnderstandingService {
  const systemConfig = makeSystemConfigMock();
  const jieba = makeJiebaMock();
  const supportability = makeSupportabilityMock();
  const tokenizerProvider = new TokenizerProviderService(systemConfig, jieba);
  return new QueryUnderstandingService(tokenizerProvider, supportability);
}

// ── Chunk helpers ─────────────────────────────────────────────────────────────

/**
 * Create a ChunkResult with score above the default gate threshold (0.7).
 * Used by T080 Scenario B (KB content present → canAnswer=true).
 */
function makeHighScoreChunk(): ChunkResult {
  return {
    knowledgeEntryId: 1,
    sourceKey: 'bh-regression',
    content: '上班時間：週一至週五 08:30–17:30',
    score: 0.85,
    language: 'zh-TW',
  };
}

/**
 * Create a ChunkResult with score below the gate threshold (0.7).
 * Used by T080 Scenario C (low score → canAnswer=false, reason='low_score').
 */
function makeLowScoreChunk(): ChunkResult {
  return {
    knowledgeEntryId: 2,
    sourceKey: 'bh-regression-low',
    content: '上班時間相關說明',
    score: 0.5,
    language: 'zh-TW',
  };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('Gate Regression (Phase 6-C)', () => {
  let quService: QueryUnderstandingService;
  let gateService: RetrievalDecisionService;

  beforeAll(() => {
    quService = makeQUService();
    gateService = new RetrievalDecisionService();
  });

  afterEach(() => { jest.clearAllMocks(); });

  // ── T079: domain-out queries → canAnswer=false ────────────────────────────

  describe('T079 — domain-out queries trigger no_results gate (SC-001)', () => {

    it('T079-fixture-count: 10 domain-out queries defined', () => {
      expect(DOMAIN_OUT_FIXTURES.length).toBe(10);
    });

    it.each(
      DOMAIN_OUT_FIXTURES.map((f) => [f.id, f] as [string, typeof f]),
    )(
      '%s: canAnswer=false when KB is empty',
      async (_id, fixture) => {
        const quResult = await quService.understand(
          fixture.query,
          fixture.language,
        );
        const decision = gateService.decideFromChunks([], quResult, 0.7);

        // SC-001: off-topic query with empty KB must never proceed to LLM
        expect(decision.canAnswer).toBe(false);
        // With chunks=[], reason is always 'no_results' (first evaluation step)
        expect(decision.reason).toBe('no_results');
        expect(decision.confidence).toBe(0);
        expect(decision.topK).toEqual([]);
      },
    );

    it('T079-aggregate: all 10 domain-out fixtures produce canAnswer=false', async () => {
      for (const fixture of DOMAIN_OUT_FIXTURES) {
        const quResult = await quService.understand(
          fixture.query,
          fixture.language,
        );
        const decision = gateService.decideFromChunks([], quResult, 0.7);
        expect(decision.canAnswer).toBe(false);
      }
    });
  });

  // ── T080: business_hours classification + gate decisions ──────────────────

  describe('T080 — business_hours gate regression (SC-003)', () => {

    it('T080-fixture-count: 5 business_hours fixtures defined', () => {
      expect(BUSINESS_HOURS_FIXTURES.length).toBe(5);
    });

    // T080-A: classification guard — queryType must be BusinessHours, not QuoteRequest
    describe('T080-A — classification: queryType=BusinessHours, never QuoteRequest', () => {
      it.each(
        BUSINESS_HOURS_FIXTURES.map((f) => [f.id, f] as [string, typeof f]),
      )(
        '%s: queryType === BusinessHours',
        async (_id, fixture) => {
          const quResult = await quService.understand(
            fixture.query,
            fixture.language,
          );

          // SC-003 guard: BUSINESS_HOURS_RE evaluated before hasBusiness check
          expect(quResult.queryType).toBe(QueryType.BusinessHours);
          expect(quResult.queryType).not.toBe(QueryType.QuoteRequest);
        },
      );
    });

    // T080-B: Scenario A — no KB content → canAnswer=false
    describe('T080-B — Scenario A: no KB content → canAnswer=false', () => {
      it.each(
        BUSINESS_HOURS_FIXTURES.map((f) => [f.id, f] as [string, typeof f]),
      )(
        '%s: canAnswer=false when chunks=[]',
        async (_id, fixture) => {
          const quResult = await quService.understand(
            fixture.query,
            fixture.language,
          );
          const decision = gateService.decideFromChunks([], quResult, 0.7);

          expect(decision.canAnswer).toBe(false);
          expect(decision.reason).toBe('no_results');
        },
      );
    });

    // T080-C: Scenario B — with KB content (score≥0.7) → canAnswer=true
    describe('T080-C — Scenario B: KB content score=0.85 → canAnswer=true', () => {
      it.each(
        BUSINESS_HOURS_FIXTURES.map((f) => [f.id, f] as [string, typeof f]),
      )(
        '%s: canAnswer=true when high-score chunk present',
        async (_id, fixture) => {
          const quResult = await quService.understand(
            fixture.query,
            fixture.language,
          );
          const chunk = makeHighScoreChunk();
          const decision = gateService.decideFromChunks([chunk], quResult, 0.7);

          expect(decision.canAnswer).toBe(true);
          expect(decision.reason).toBe('ok');
          expect(decision.topK.length).toBeGreaterThan(0);
        },
      );
    });

    // T080-D: Scenario C — low score (< 0.7) → canAnswer=false, reason=low_score
    it('T080-D — Scenario C: score=0.5 < threshold → canAnswer=false, reason=low_score', async () => {
      const quResult = await quService.understand(
        BUSINESS_HOURS_FIXTURES[0].query,
        BUSINESS_HOURS_FIXTURES[0].language,
      );
      const chunk = makeLowScoreChunk();
      const decision = gateService.decideFromChunks([chunk], quResult, 0.7);

      expect(decision.canAnswer).toBe(false);
      expect(decision.reason).toBe('low_score');
      expect(decision.confidence).toBeLessThan(1);
    });

    // T080-E: score exactly at threshold edge (0.7) → canAnswer=true (≥ threshold)
    it('T080-E — score=0.7 exactly at threshold → canAnswer=true', async () => {
      const quResult = await quService.understand(
        BUSINESS_HOURS_FIXTURES[0].query,
        BUSINESS_HOURS_FIXTURES[0].language,
      );
      const chunkAtThreshold: ChunkResult = {
        knowledgeEntryId: 3,
        sourceKey: 'bh-threshold',
        content: '上班時間說明',
        score: 0.7,
        language: 'zh-TW',
      };
      const decision = gateService.decideFromChunks([chunkAtThreshold], quResult, 0.7);

      // score (0.7) is NOT strictly less than minScore (0.7) → passes
      expect(decision.canAnswer).toBe(true);
      expect(decision.reason).toBe('ok');
    });
  });
});
