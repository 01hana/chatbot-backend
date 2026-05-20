/**
 * no-answer-gate.fixture.ts — Regression fixtures for Phase 6-C (T079 + T080)
 *
 * T079: domain-out queries — must trigger canAnswer=false via 'no_results' gate
 * T080: business_hours queries — queryType=BusinessHours, NOT QuoteRequest;
 *         Scenario A (no KB): canAnswer=false
 *         Scenario B (with KB, score≥0.7): canAnswer=true
 *
 * Baseline: 2026-05-18 (Phase 6-C)
 */

/**
 * GateRegressionFixture — a golden query pair for testing the
 * RetrievalDecisionService gate logic in conjunction with
 * QueryUnderstandingService.
 */
export interface GateRegressionFixture {
  /** Unique identifier for this fixture. */
  id: string;
  /** The user's raw query string. */
  query: string;
  /** Language of the query. */
  language: 'zh-TW' | 'en';
  /** Human-readable note about the fixture's intent. */
  notes?: string;
}

/**
 * BusinessHoursFixture — extends GateRegressionFixture with a queryType
 * regression guard to prevent "上班時間" queries from being misclassified
 * as QuoteRequest (SC-003).
 */
export interface BusinessHoursFixture extends GateRegressionFixture {
  /**
   * QueryType that MUST NOT be produced by the classifier.
   * Guards against SC-003 regression: "上班時間" misclassified as QuoteRequest.
   */
  forbiddenQueryType: 'QuoteRequest';
  /** Expected QueryType string value from QueryTypeClassifier. */
  expectedQueryType: 'BusinessHours';
}

// ── T079: Domain-out fixtures (10 queries) ───────────────────────────────────

/**
 * DOMAIN_OUT_FIXTURES — queries completely outside the fastener/hardware domain.
 *
 * When no KB content is present (chunks=[]), the No-answer Gate must return
 * canAnswer=false with reason='no_results'.  This proves SC-001: off-topic
 * queries never trigger LLM calls when the KB has no matching content.
 */
export const DOMAIN_OUT_FIXTURES: GateRegressionFixture[] = [
  {
    id: 'domain-out-001',
    query: '今天天氣如何',
    language: 'zh-TW',
    notes: '天氣查詢 — 完全超出產品/業務範圍',
  },
  {
    id: 'domain-out-002',
    query: '幫我寫一首情詩',
    language: 'zh-TW',
    notes: '創作請求 — 無任何產品或業務相關性',
  },
  {
    id: 'domain-out-003',
    query: '台積電股價會漲嗎',
    language: 'zh-TW',
    notes: '股市查詢 — 非業務範疇',
  },
  {
    id: 'domain-out-004',
    query: '幫我推薦今晚的晚餐',
    language: 'zh-TW',
    notes: '餐廳推薦 — 無任何硬體/緊固件相關性',
  },
  {
    id: 'domain-out-005',
    query: '給我一個 Python 氣泡排序的範例',
    language: 'zh-TW',
    notes: '程式設計教學 — 非產品知識',
  },
  {
    id: 'domain-out-006',
    query: '世界盃足球賽冠軍是哪個國家',
    language: 'zh-TW',
    notes: '運動賽事 — 完全無關',
  },
  {
    id: 'domain-out-007',
    query: '幫我規劃東京三天兩夜的旅遊行程',
    language: 'zh-TW',
    notes: '旅遊規劃 — 無任何業務相關性',
  },
  {
    id: 'domain-out-008',
    query: '請解釋量子糾纏的原理',
    language: 'zh-TW',
    notes: '物理學知識 — 非產品領域',
  },
  {
    id: 'domain-out-009',
    query: '請幫我把這段英文翻譯成日文',
    language: 'zh-TW',
    notes: '翻譯請求 — 非業務範疇',
  },
  {
    id: 'domain-out-010',
    query: 'What is the best restaurant in Taipei?',
    language: 'en',
    notes: 'English domain-out: restaurant query, no fastener/hardware relevance',
  },
];

// ── T080: Business-hours fixtures (5 queries) ────────────────────────────────

/**
 * BUSINESS_HOURS_FIXTURES — queries asking about office hours, operating days,
 * or company location.
 *
 * Regression guard (SC-003): these must be classified as BusinessHours, NOT
 * QuoteRequest.  BUSINESS_HOURS_RE is evaluated BEFORE the generic hasBusiness
 * check in QueryTypeClassifier to prevent misclassification.
 *
 * Gate scenarios:
 *  - Scenario A (chunks=[]): canAnswer=false, reason='no_results'
 *  - Scenario B (chunks with score≥0.7): canAnswer=true, reason='ok'
 */
export const BUSINESS_HOURS_FIXTURES: BusinessHoursFixture[] = [
  {
    id: 'bh-001',
    query: '你們上班時間是什麼時候',
    language: 'zh-TW',
    forbiddenQueryType: 'QuoteRequest',
    expectedQueryType: 'BusinessHours',
    notes: '上班時間查詢 — SC-003 regression: BUSINESS_HOURS_RE matches "上班"',
  },
  {
    id: 'bh-002',
    query: '公司幾點開始營業',
    language: 'zh-TW',
    forbiddenQueryType: 'QuoteRequest',
    expectedQueryType: 'BusinessHours',
    notes: '營業時間查詢 — BUSINESS_HOURS_RE matches "營業"',
  },
  {
    id: 'bh-003',
    query: '請問公司地址在哪裡',
    language: 'zh-TW',
    forbiddenQueryType: 'QuoteRequest',
    expectedQueryType: 'BusinessHours',
    notes: '地址查詢 — BUSINESS_HOURS_RE matches "地址" + "在哪"',
  },
  {
    id: 'bh-004',
    query: '工作日是週一到週五嗎',
    language: 'zh-TW',
    forbiddenQueryType: 'QuoteRequest',
    expectedQueryType: 'BusinessHours',
    notes: '工作日查詢 — BUSINESS_HOURS_RE matches "工作日"',
  },
  {
    id: 'bh-005',
    query: 'What are your business hours?',
    language: 'en',
    forbiddenQueryType: 'QuoteRequest',
    expectedQueryType: 'BusinessHours',
    notes: 'English: BUSINESS_HOURS_RE matches "business hours"',
  },
];
