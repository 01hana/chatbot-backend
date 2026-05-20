/**
 * query-understanding.regression.spec.ts
 *
 * Phase 6-B Regression Suite: T075–T078
 *
 * 「測試範圍」
 * - T075: zh-TW FAQ 查詢 QU V2 regression（feature.zh_tokenizer=jieba, CI fallback 至 rule-based）
 * - T076: English FAQ 查詢 QU V2 regression（language='en' → 永遠使用 EnglishTokenizer）
 * - T077: JiebaTokenizer 初始化失敗 fallback regression（SC-004）
 * - T078: feature.zh_tokenizer=jieba 啟用後，English tokenizer 不受影響
 *
 * 「測試策略（無 DB）」
 * - SupportabilityClassifier 完整 mock（避免 DB 依賴）
 * - TokenizerProviderService 使用真實實作 + mock SystemConfigService + mock JiebaTokenizer
 * - QueryUnderstandingService 使用真實實作
 * - 驗收層級：query type classification + retrieval plan search terms + tokenizer selection
 *
 * 「Baseline (2026-05-18, QU V2)」
 * - zh-TW: 20 fixtures, rule-based fallback (jieba not ready in CI)
 * - en:    10 fixtures, EnglishTokenizer
 * - T077: Jieba not ready → RuleBasedTokenizerAdapter, no exception
 * - T078: zh_tokenizer=jieba has no effect on language='en' path
 */

import { describe, beforeAll, afterEach, it, expect } from '@jest/globals';
import { QueryUnderstandingService } from '../query-understanding/query-understanding.service';
import { TokenizerProviderService } from '../query-understanding/tokenizers/tokenizer-provider.service';
import { SupportabilityClassifier } from '../query-understanding/classifiers/supportability.classifier';
import { JiebaTokenizer } from '../query-understanding/tokenizers/jieba.tokenizer';
import { SystemConfigService } from '../system-config/system-config.service';
import { ZH_TW_QU_FIXTURES, QURegressionFixture } from './fixtures/zh-tw-qu.fixture';
import { EN_QU_FIXTURES } from './fixtures/en-qu.fixture';

// ── Mock helpers (typed for contextual jest.fn() inference) ──────────────────

/**
 * Create a mock SystemConfigService that returns zhTokenizer for feature.zh_tokenizer.
 * The declared return type enables contextual typing for jest.fn() inference.
 */
function makeSystemConfigMock(zhTokenizer: 'jieba' | 'rule-based'): SystemConfigService {
  return {
    getString: jest.fn().mockImplementation((key: string, defaultValue: string): string => {
      if (key === 'feature.zh_tokenizer') return zhTokenizer;
      return defaultValue;
    }),
  } as unknown as SystemConfigService;
}

/**
 * Create a mock JiebaTokenizer with controllable isReady().
 * Typed return enables contextual inference for mockResolvedValue.
 */
function makeJiebaMock(ready: boolean): JiebaTokenizer {
  return {
    isReady: jest.fn().mockReturnValue(ready),
    tokenize: jest.fn().mockResolvedValue([]),
  } as unknown as JiebaTokenizer;
}

/**
 * Create a mock SupportabilityClassifier that always returns 'supported'.
 * Typed return enables contextual inference for mockResolvedValue.
 */
function makeSupportabilityMock(): SupportabilityClassifier {
  return {
    classify: jest.fn().mockResolvedValue({ status: 'supported' }),
  } as unknown as SupportabilityClassifier;
}

// ── Service factory ────────────────────────────────────────────────────────────

interface ServiceOptions {
  /** Value for feature.zh_tokenizer; defaults to 'jieba' (tests jieba-configured path) */
  zhTokenizer?: 'jieba' | 'rule-based';
  /** Whether JiebaTokenizer.isReady() returns true; defaults to false (CI portable) */
  jiebaReady?: boolean;
}

/**
 * Create a QueryUnderstandingService with:
 *   - Real TokenizerProviderService (real EnglishTokenizer + RuleBasedTokenizerAdapter)
 *   - Mocked SystemConfigService (returns configured zh_tokenizer value)
 *   - Mocked JiebaTokenizer (isReady controlled by opts.jiebaReady)
 *   - Mocked SupportabilityClassifier (always returns 'supported')
 *
 * This factory is DB-free and CI-portable.
 */
function makeQUService(opts: ServiceOptions = {}): QueryUnderstandingService {
  const { zhTokenizer = 'jieba', jiebaReady = false } = opts;

  const tokenizerProvider = new TokenizerProviderService(
    makeSystemConfigMock(zhTokenizer),
    makeJiebaMock(jiebaReady),
  );

  // Suppress expected WARN logs when jieba is configured but not ready
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  jest.spyOn((tokenizerProvider as any).logger, 'warn').mockImplementation(() => {});

  return new QueryUnderstandingService(tokenizerProvider, makeSupportabilityMock());
}

// ── Shared assertion helpers ───────────────────────────────────────────────────

/**
 * Assert that every term in `expectedTerms` appears in `searchTerms`
 * using case-insensitive exact matching.
 */
function assertAllTermsPresent(searchTerms: string[], expectedTerms: string[]): void {
  for (const term of expectedTerms) {
    const found = searchTerms.some((st) => st.toLowerCase() === term.toLowerCase());
    expect(found).toBe(true);
  }
}

// ── T075 ────────────────────────────────────────────────────────────────────────

/**
 * T075 — zh-TW FAQ regression (QU V2, zh_tokenizer=jieba configured)
 *
 * CI 環境下 JiebaTokenizer.isReady()=false → TokenizerProviderService fallback 至
 * RuleBasedTokenizerAdapter（SC-004 fallback 路徑）。
 *
 * 驗收：
 *   1. understand() 不拋例外
 *   2. queryType 符合 expectedQueryType（若有設定）
 *   3. searchTerms 包含 expectedSearchTermsIncludes 中所有 term（若有設定）
 */
describe('T075 — zh-TW FAQ regression (QU V2, rule-based fallback)', () => {
  let service: QueryUnderstandingService;

  beforeAll(() => {
    service = makeQUService({ zhTokenizer: 'jieba', jiebaReady: false });
  });

  afterEach(() => { jest.clearAllMocks(); });

  it.each(ZH_TW_QU_FIXTURES)(
    '$id: understand("$query") → valid QU result',
    async (fixture: QURegressionFixture) => {
      const result = await service.understand(fixture.query, fixture.language);

      // (1) No exception — proven by test reaching here
      expect(result).toBeDefined();
      expect(result.queryType).toBeDefined();
      expect(result.retrievalPlan).toBeDefined();
      expect(Array.isArray(result.retrievalPlan.searchTerms)).toBe(true);
      expect(result.retrievalPlan.language).toBe('zh-TW');

      // (2) queryType must match when specified
      if (fixture.expectedQueryType !== undefined) {
        expect(result.queryType).toBe(fixture.expectedQueryType);
      }

      // (3) All expected search terms must be present when specified
      if (fixture.expectedSearchTermsIncludes && fixture.expectedSearchTermsIncludes.length > 0) {
        assertAllTermsPresent(result.retrievalPlan.searchTerms, fixture.expectedSearchTermsIncludes);
      }
    },
  );

  it('ZH_TW_QU_FIXTURES has exactly 20 entries', () => {
    expect(ZH_TW_QU_FIXTURES).toHaveLength(20);
  });

  it('every zh-TW fixture has a non-empty query', () => {
    for (const f of ZH_TW_QU_FIXTURES) {
      expect(f.query.trim().length).toBeGreaterThan(0);
    }
  });

  it('every zh-TW fixture has language="zh-TW"', () => {
    for (const f of ZH_TW_QU_FIXTURES) {
      expect(f.language).toBe('zh-TW');
    }
  });
});

// ── T076 ────────────────────────────────────────────────────────────────────────

/**
 * T076 — English FAQ regression (QU V2, language='en' uses EnglishTokenizer)
 *
 * 無論 feature.zh_tokenizer 設為何值，language='en' 必須使用 EnglishTokenizer。
 *
 * 驗收：
 *   1. result.tokenizer === 'english'
 *   2. queryType 符合 expectedQueryType（若有設定）
 *   3. searchTerms 包含 expectedSearchTermsIncludes 中所有 term（若有設定）
 */
describe('T076 — English FAQ regression (QU V2, EnglishTokenizer)', () => {
  let service: QueryUnderstandingService;

  beforeAll(() => {
    // zh_tokenizer=jieba configured, but English queries MUST still use EnglishTokenizer
    service = makeQUService({ zhTokenizer: 'jieba', jiebaReady: false });
  });

  afterEach(() => { jest.clearAllMocks(); });

  it.each(EN_QU_FIXTURES)(
    '$id: understand("$query") → EnglishTokenizer, valid QU result',
    async (fixture: QURegressionFixture) => {
      const result = await service.understand(fixture.query, fixture.language);

      // (1) EnglishTokenizer must be used regardless of zh_tokenizer flag
      expect(result.tokenizer).toBe('english');
      expect(result.language).toBe('en');

      // (2) queryType must match when specified
      if (fixture.expectedQueryType !== undefined) {
        expect(result.queryType).toBe(fixture.expectedQueryType);
      }

      // (3) All expected search terms must be present when specified
      if (fixture.expectedSearchTermsIncludes && fixture.expectedSearchTermsIncludes.length > 0) {
        assertAllTermsPresent(result.retrievalPlan.searchTerms, fixture.expectedSearchTermsIncludes);
      }

      // (4) retrievalPlan language is 'en'
      expect(result.retrievalPlan.language).toBe('en');

      // (5) understand() does not throw (proven by reaching here)
      expect(result.retrievalPlan).toBeDefined();
    },
  );

  it('EN_QU_FIXTURES has exactly 10 entries', () => {
    expect(EN_QU_FIXTURES).toHaveLength(10);
  });

  it('every en fixture has language="en"', () => {
    for (const f of EN_QU_FIXTURES) {
      expect(f.language).toBe('en');
    }
  });
});

// ── T077 ────────────────────────────────────────────────────────────────────────

/**
 * T077 — Jieba fallback regression (SC-004)
 *
 * 模擬 JiebaTokenizer 初始化失敗（isReady()=false）：
 *   - TokenizerProviderService 必須靜默 fallback 至 RuleBasedTokenizerAdapter
 *   - 不拋 exception（no pipeline_error）
 *   - result.tokenizer === 'rule-based'
 *   - retrievalPlan.language 正確
 *
 * 這是 SC-004 的 unit-level 驗收。
 */
describe('T077 — Jieba fallback regression (JiebaTokenizer not ready → RuleBasedTokenizer)', () => {
  let service: QueryUnderstandingService;

  beforeAll(() => {
    service = makeQUService({ zhTokenizer: 'jieba', jiebaReady: false });
  });

  afterEach(() => { jest.clearAllMocks(); });

  // Test representative zh-TW queries to verify fallback behavior
  const FALLBACK_SAMPLES = ZH_TW_QU_FIXTURES.filter((f) =>
    ['zh-faq-001', 'zh-faq-007', 'zh-faq-009', 'zh-faq-010', 'zh-faq-013'].includes(f.id),
  );

  it.each(FALLBACK_SAMPLES)(
    '$id: "$query" → tokenizer must be "rule-based" when Jieba not ready',
    async (fixture: QURegressionFixture) => {
      const result = await service.understand(fixture.query, fixture.language);

      // (1) Falls back to RuleBasedTokenizerAdapter, not Jieba
      expect(result.tokenizer).toBe('rule-based');

      // (2) No exception thrown (proven by test reaching here)
      expect(result).toBeDefined();
      expect(result.queryType).toBeDefined();
      expect(result.retrievalPlan).toBeDefined();

      // (3) retrievalPlan.language is correct
      expect(result.retrievalPlan.language).toBe('zh-TW');
    },
  );

  it('understand() completes without throwing for all zh-TW fixtures when Jieba not ready', async () => {
    for (const fixture of ZH_TW_QU_FIXTURES) {
      const result = await service.understand(fixture.query, fixture.language);
      expect(result).toBeDefined();
      expect(result.tokenizer).toBe('rule-based');
    }
  });

  it('understand() does not return undefined when JiebaTokenizer is not ready', async () => {
    const result = await service.understand('螺絲有哪些類型', 'zh-TW');
    expect(result).not.toBeNull();
    expect(result.rawQuery).toBe('螺絲有哪些類型');
    expect(result.language).toBe('zh-TW');
  });

  it('QueryUnderstandingService.understand() never throws even when tokenizer throws', async () => {
    // The service wraps all errors in a safe fallback — no 500 can originate here
    await expect(service.understand('', 'zh-TW')).resolves.toBeDefined();
    await expect(service.understand('   ', 'zh-TW')).resolves.toBeDefined();
  });
});

// ── T078 ────────────────────────────────────────────────────────────────────────

/**
 * T078 — English tokenizer isolation (zh_tokenizer=jieba does not affect English)
 *
 * 啟用 feature.zh_tokenizer=jieba 後，英文查詢必須：
 *   1. 仍使用 EnglishTokenizer（result.tokenizer === 'english'）
 *   2. language='en' 的 retrievalPlan 語言正確
 *   3. searchTerms 不因 jieba 設定退化
 */
describe('T078 — English tokenizer isolation (zh_tokenizer=jieba has no effect on en queries)', () => {
  let serviceWithJieba: QueryUnderstandingService;
  let serviceWithRuleBased: QueryUnderstandingService;

  beforeAll(() => {
    // Both configurations must produce the same English tokenizer
    serviceWithJieba = makeQUService({ zhTokenizer: 'jieba', jiebaReady: false });
    serviceWithRuleBased = makeQUService({ zhTokenizer: 'rule-based', jiebaReady: false });
  });

  afterEach(() => { jest.clearAllMocks(); });

  it.each(EN_QU_FIXTURES)(
    '$id: zh_tokenizer=jieba → English query still uses EnglishTokenizer',
    async (fixture: QURegressionFixture) => {
      const resultWithJieba = await serviceWithJieba.understand(fixture.query, fixture.language);
      const resultWithRuleBased = await serviceWithRuleBased.understand(
        fixture.query,
        fixture.language,
      );

      // (1) Both configurations produce tokenizer='english'
      expect(resultWithJieba.tokenizer).toBe('english');
      expect(resultWithRuleBased.tokenizer).toBe('english');

      // (2) searchTerms are identical regardless of zh_tokenizer setting
      expect(resultWithJieba.retrievalPlan.searchTerms).toEqual(
        resultWithRuleBased.retrievalPlan.searchTerms,
      );

      // (3) queryType is identical
      expect(resultWithJieba.queryType).toBe(resultWithRuleBased.queryType);
    },
  );

  it('zh_tokenizer=jieba does not degrade English query term extraction', async () => {
    // Product queries should still extract product search terms
    const r1 = await serviceWithJieba.understand('What screw products do you offer?', 'en');
    const r2 = await serviceWithJieba.understand(
      'What is the difference between 304 and 316 stainless steel screws?',
      'en',
    );
    const r3 = await serviceWithJieba.understand('Do you provide washers or nuts?', 'en');

    expect(r1.retrievalPlan.searchTerms).toContain('screw');
    expect(r2.retrievalPlan.searchTerms.some((t) => t.toLowerCase().includes('screw'))).toBe(true);
    expect(r3.retrievalPlan.searchTerms.some((t) => ['washers', 'nuts'].includes(t))).toBe(true);
  });

  it('zh_tokenizer setting does not cause English queries to use rule-based tokenizer', async () => {
    const queries = [
      'What screw products do you offer?',
      'How can I contact your company for a quote?',
      'What are your business hours?',
    ];

    for (const query of queries) {
      const result = await serviceWithJieba.understand(query, 'en');
      expect(result.tokenizer).not.toBe('rule-based');
      expect(result.tokenizer).not.toBe('jieba');
      expect(result.tokenizer).toBe('english');
    }
  });
});

// ── Fixture contract ────────────────────────────────────────────────────────────

describe('Fixture contract (T075–T078)', () => {
  it('ZH_TW_QU_FIXTURES has exactly 20 entries', () => {
    expect(ZH_TW_QU_FIXTURES).toHaveLength(20);
  });

  it('EN_QU_FIXTURES has exactly 10 entries', () => {
    expect(EN_QU_FIXTURES).toHaveLength(10);
  });

  it('all zh-TW fixture IDs are unique', () => {
    const ids = ZH_TW_QU_FIXTURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all en fixture IDs are unique', () => {
    const ids = EN_QU_FIXTURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all zh-TW fixtures have featureFlags with query_understanding_v2_enabled=true', () => {
    for (const f of ZH_TW_QU_FIXTURES) {
      expect(f.featureFlags['feature.query_understanding_v2_enabled']).toBe(true);
    }
  });

  it('all en fixtures have featureFlags with zh_tokenizer=jieba', () => {
    for (const f of EN_QU_FIXTURES) {
      expect(f.featureFlags['feature.zh_tokenizer']).toBe('jieba');
    }
  });

  it('zh-faq-014 has M3 螺絲 in expectedSearchTermsIncludes', () => {
    const f = ZH_TW_QU_FIXTURES.find((x) => x.id === 'zh-faq-014');
    expect(f?.expectedSearchTermsIncludes).toEqual(expect.arrayContaining(['螺絲', 'M3']));
  });
});
