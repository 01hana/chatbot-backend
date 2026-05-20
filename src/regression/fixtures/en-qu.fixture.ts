/**
 * en-qu.fixture.ts — English Query Understanding V2 Regression Fixtures (T076 / T078)
 *
 * 10 English FAQ 查詢的 golden fixtures，用於驗證：
 *   - QU V2 對英文查詢正確使用 EnglishTokenizer（T076）
 *   - feature.zh_tokenizer=jieba 啟用後英文查詢不退化（T078）
 *
 * 功能旗標設定：
 *   feature.query_understanding_v2_enabled = true
 *   feature.zh_tokenizer                   = jieba   (對英文查詢無影響，應仍使用 EnglishTokenizer)
 *   feature.hybrid_retrieval_enabled       = true
 *   feature.no_answer_gate_enabled         = true
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │  Tokenizer 設計                                                            │
 * │  TokenizerProviderService: language='en' → 永遠使用 EnglishTokenizer       │
 * │  zh_tokenizer feature flag 對 English path 完全無影響                      │
 * └────────────────────────────────────────────────────────────────────────────┘
 */

import type { QURegressionFixture } from './zh-tw-qu.fixture';

/** Feature flags shared by all T076/T078 English fixtures */
const EN_FLAGS: Record<string, string | boolean> = {
  'feature.query_understanding_v2_enabled': true,
  'feature.zh_tokenizer': 'jieba',
  'feature.hybrid_retrieval_enabled': true,
  'feature.no_answer_gate_enabled': true,
};

/**
 * EN_QU_FIXTURES — 10 English FAQ regression fixtures (T076 / T078)
 *
 * Baseline (2026-05-18, QU V2):
 *   - Target: 10 fixtures
 *   - Tokenizer: EnglishTokenizer (language='en' override, zh_tokenizer irrelevant)
 *   - expectedSearchTermsIncludes are lowercased to match EnglishTokenizer normalizedText
 *
 * Note on en-faq-007 "Where is your company located?":
 *   'located' does not match BUSINESS_RE ('^location$') or BUSINESS_HOURS_RE ('/location/i').
 *   queryType = Unknown at rule-based / EnglishTokenizer level.
 *   expectedQueryType not set; test verifies no exception and tokenizer='english'.
 */
export const EN_QU_FIXTURES: QURegressionFixture[] = [
  // ── Screw products ──────────────────────────────────────────────────────────
  {
    id: 'en-faq-001',
    query: 'What screw products do you offer?',
    language: 'en',
    featureFlags: EN_FLAGS,
    expectedAction: 'answer',
    expectedQueryType: 'product_lookup',
    expectedSearchTermsIncludes: ['screw'],
    notes: '基礎螺絲查詢，EnglishTokenizer: "screw" → Product',
  },
  {
    id: 'en-faq-002',
    query: 'What is the difference between 304 and 316 stainless steel screws?',
    language: 'en',
    featureFlags: EN_FLAGS,
    expectedAction: 'answer',
    expectedQueryType: 'product_comparison',
    expectedSearchTermsIncludes: ['screws'],
    notes: 'COMPARISON_RE 含 "difference" → ProductComparison；"stainless steel" 為 Material phrase',
  },
  {
    id: 'en-faq-003',
    query: 'Can stainless steel screws be used near the coast?',
    language: 'en',
    featureFlags: EN_FLAGS,
    expectedAction: 'answer',
    expectedQueryType: 'product_lookup',
    expectedSearchTermsIncludes: ['screws'],
    notes: '"stainless steel" phrase → Material；"screws" → Product',
  },
  // ── Catalog & business ────────────────────────────────────────────────────
  {
    id: 'en-faq-004',
    query: 'How can I download the product catalog?',
    language: 'en',
    featureFlags: EN_FLAGS,
    expectedAction: 'answer',
    expectedQueryType: 'catalog_download',
    expectedSearchTermsIncludes: ['catalog'],
    notes: '"catalog" → Business；CATALOG_RE matches → CatalogDownload',
  },
  {
    id: 'en-faq-005',
    query: 'How can I contact your company for a quote?',
    language: 'en',
    featureFlags: EN_FLAGS,
    expectedAction: 'answer',
    expectedQueryType: 'contact',
    expectedSearchTermsIncludes: ['contact'],
    notes: '"contact" → Contact token；hasContact 優先於 hasBusiness → Contact',
  },
  {
    id: 'en-faq-006',
    query: 'What are your business hours?',
    language: 'en',
    featureFlags: EN_FLAGS,
    expectedAction: 'answer',
    expectedQueryType: 'business_hours',
    expectedSearchTermsIncludes: ['business hours'],
    notes: '"business hours" → phrase → Business；BUSINESS_HOURS_RE matches → BusinessHours',
  },
  {
    id: 'en-faq-007',
    query: 'Where is your company located?',
    language: 'en',
    featureFlags: EN_FLAGS,
    expectedAction: 'answer',
    notes:
      '"located" 不在 BUSINESS_RE (^location$) 或 BUSINESS_HOURS_RE；queryType=Unknown at EnglishTokenizer level；' +
      '不設 expectedQueryType，僅驗證 tokenizer=english 且無例外',
  },
  // ── Products ────────────────────────────────────────────────────────────────
  {
    id: 'en-faq-008',
    query: 'Do you offer custom screws?',
    language: 'en',
    featureFlags: EN_FLAGS,
    expectedAction: 'answer',
    expectedQueryType: 'product_lookup',
    expectedSearchTermsIncludes: ['screws'],
    notes: '"screws" → Product；"custom" → Unknown（不在任何分類 RE）',
  },
  {
    id: 'en-faq-009',
    query: 'What fastener materials are available?',
    language: 'en',
    featureFlags: EN_FLAGS,
    expectedAction: 'answer',
    expectedQueryType: 'product_lookup',
    expectedSearchTermsIncludes: ['fastener'],
    notes: '"fastener" → Product；"materials" → Unknown（不在 MATERIAL_RE）；"available" 為 stop word',
  },
  {
    id: 'en-faq-010',
    query: 'Do you provide washers or nuts?',
    language: 'en',
    featureFlags: EN_FLAGS,
    expectedAction: 'answer',
    expectedQueryType: 'product_lookup',
    expectedSearchTermsIncludes: ['washers'],
    notes: '"washers", "nuts" → Product；"provide" 為 stop word',
  },
];
