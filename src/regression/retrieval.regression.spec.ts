/**
 * retrieval.regression.spec.ts — Query-understanding regression baseline (RG-003, Route B)
 *
 * 「Route B 定位」
 * 本 spec 驗證的是「查詢理解層」是否正常運作，而不是資料庫 retrieval 命中率。
 * DB-backed `retrievalService.retrieve()` top-3 命中率驗證為 e2e / integration suite
 * 範疇，需 seed DB 環境，待後續 Phase 補充。
 *
 * 「本 spec 實際測試」
 * 1. QueryNormalizer.normalize() output 含有 expectedTerms
 *    (feature.query_analysis_enabled = false / 001 path)
 * 2. RuleBasedQueryAnalyzer.analyze() terms/normalizedQuery 含有 expectedTerms
 *    (feature.query_analysis_enabled = true  / 002 path)
 *
 * 「待後續補充」
 * Full end-to-end retrieval top-3 hit-rate testing (DB required):
 * → Integration / e2e test suite with real seed DB (not yet implemented)
 * → zh-TW target ≥ 95% (19/20), en target ≥ 90% (9/10)
 *
 * 「Baseline (2026-04-28, seed v002)」
 * • zh-TW: 20 fixtures, term-extraction rate = 20/20 (100%)
 * • en:    10 fixtures, term-extraction rate = 10/10 (100%)
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { QueryNormalizer } from '../retrieval/query-normalizer';
import { RuleBasedQueryAnalyzer } from '../query-analysis/analyzers/rule-based-query-analyzer';
import { FAQ_ZH_FIXTURES } from './fixtures/faq-zh.fixtures';
import { FAQ_EN_FIXTURES } from './fixtures/faq-en.fixtures';

// Combine all fixtures for the shared loop
const ALL_FIXTURES = [...FAQ_ZH_FIXTURES, ...FAQ_EN_FIXTURES];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Check that at least one expectedTerm appears (case-insensitive) in the
 * candidate string. This mirrors the retrieval condition: the query must contain
 * a keyword that matches the knowledge entry's title / content / tags.
 */
function containsAnyTerm(candidate: string, terms: string[]): boolean {
  const lower = candidate.toLowerCase();
  return terms.some((t) => lower.includes(t.toLowerCase()));
}

// ── Feature flag OFF: QueryNormalizer (001 path) ─────────────────────────────

describe('Retrieval regression — feature.query_analysis_enabled=false (QueryNormalizer)', () => {
  it.each(ALL_FIXTURES)(
    '[zh-flag-off] "$query" → should contain at least one of $expectedTerms after normalize',
    ({ query, language, expectedTerms }) => {
      const normalized = QueryNormalizer.normalize(query, language);
      expect(
        containsAnyTerm(normalized, expectedTerms),
      ).toBe(true);
    },
  );
});

// ── Feature flag ON: RuleBasedQueryAnalyzer (002 path) ───────────────────────

describe('Retrieval regression — feature.query_analysis_enabled=true (RuleBasedQueryAnalyzer)', () => {
  let analyzer: RuleBasedQueryAnalyzer;

  beforeAll(() => {
    // No rule provider or expansion provider — standalone run uses hardcoded
    // stop-word lists (same fallback as production when DB cache is cold).
    analyzer = new RuleBasedQueryAnalyzer();
  });

  it.each(ALL_FIXTURES)(
    '[qa-flag-on] "$query" → normalizedQuery or terms should contain at least one of $expectedTerms',
    async ({ query, language, expectedTerms }) => {
      const result = await analyzer.analyze(query, language);

      // Check normalizedQuery first (most important signal)
      const normalizedHit = containsAnyTerm(result.normalizedQuery, expectedTerms);

      // Also allow a hit in the raw terms array
      const termsHit = result.terms.some((t) =>
        expectedTerms.some((exp) => t.toLowerCase().includes(exp.toLowerCase())),
      );

      expect(normalizedHit || termsHit).toBe(true);
    },
  );
});

// ── Fixture structure validation ─────────────────────────────────────────────

describe('Fixture contract', () => {
  it('FAQ_ZH_FIXTURES has exactly 20 entries', () => {
    expect(FAQ_ZH_FIXTURES).toHaveLength(20);
  });

  it('FAQ_EN_FIXTURES has exactly 10 entries', () => {
    expect(FAQ_EN_FIXTURES).toHaveLength(10);
  });

  it('every fixture has a non-empty expectedSourceKey', () => {
    for (const f of ALL_FIXTURES) {
      expect(f.expectedSourceKey.length).toBeGreaterThan(0);
    }
  });

  it('every fixture has at least one expectedTerm', () => {
    for (const f of ALL_FIXTURES) {
      expect(f.expectedTerms.length).toBeGreaterThan(0);
    }
  });
});
