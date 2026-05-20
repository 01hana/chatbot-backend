/**
 * zh-tw-qu.fixture.ts — zh-TW Query Understanding V2 Regression Fixtures (T075)
 *
 * 20 繁體中文 FAQ 查詢的 golden fixtures，用於驗證 QueryUnderstandingService
 * (QU V2) 啟用後，queryType 與 searchTerms 不退化。
 *
 * 功能旗標設定：
 *   feature.query_understanding_v2_enabled = true
 *   feature.zh_tokenizer                   = jieba   (CI 無 native addon → fallback rule-based)
 *   feature.hybrid_retrieval_enabled       = true
 *   feature.no_answer_gate_enabled         = true
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │  Tokenizer 說明                                                            │
 * │  - CI 環境（無 nodejieba）：JiebaTokenizer.isReady()=false                 │
 * │    → TokenizerProviderService 靜默 fallback 至 RuleBasedTokenizerAdapter   │
 * │  - 部分查詢（如「有哪些扣件材質可以選」）在 rule-based fallback 下         │
 * │    無法正確萃取語意 token；這是已知限制，fixture 以 notes 標記              │
 * └────────────────────────────────────────────────────────────────────────────┘
 */

/**
 * QURegressionFixture — 查詢理解 V2 regression fixture 結構。
 *
 * `expectedAction`            — 文件性：整合 pipeline 預期的最終回應類型。
 * `expectedQueryType`         — unit level 驗收：若設定，queryType 必須完全符合。
 * `expectedSearchTermsIncludes` — unit level 驗收：若設定，陣列中每個 term 都必須
 *                                 出現在 retrievalPlan.searchTerms（大小寫不敏感完全匹配）。
 * `notes`                     — 說明已知限制或測試意圖。
 */
export interface QURegressionFixture {
  id: string;
  query: string;
  language: 'zh-TW' | 'en';
  featureFlags: Record<string, string | boolean>;
  expectedAction: 'answer' | 'template' | 'fallback';
  expectedQueryType?: string;
  expectedSearchTermsIncludes?: string[];
  notes?: string;
}

/** Feature flags shared by all T075 zh-TW fixtures */
const ZH_TW_FLAGS: Record<string, string | boolean> = {
  'feature.query_understanding_v2_enabled': true,
  'feature.zh_tokenizer': 'jieba',
  'feature.hybrid_retrieval_enabled': true,
  'feature.no_answer_gate_enabled': true,
};

/**
 * ZH_TW_QU_FIXTURES — 20 繁體中文 FAQ regression fixtures (T075)
 *
 * Baseline (2026-05-18, QU V2):
 *   - Target: 20 fixtures
 *   - Tokenizer in CI: RuleBasedTokenizerAdapter (jieba fallback)
 *   - expectedQueryType set for 17/20 (3 edge cases marked with notes)
 */
export const ZH_TW_QU_FIXTURES: QURegressionFixture[] = [
  // ── 螺絲類 ────────────────────────────────────────────────────────────────
  {
    id: 'zh-faq-001',
    query: '你們有哪些螺絲類別',
    language: 'zh-TW',
    featureFlags: ZH_TW_FLAGS,
    expectedAction: 'answer',
    expectedQueryType: 'product_lookup',
    expectedSearchTermsIncludes: ['螺絲'],
    notes: '基礎螺絲類別查詢，應命中 screw-overview',
  },
  {
    id: 'zh-faq-002',
    query: '我想知道不鏽鋼螺絲 304 跟 316 差在哪',
    language: 'zh-TW',
    featureFlags: ZH_TW_FLAGS,
    expectedAction: 'answer',
    expectedQueryType: 'product_comparison',
    expectedSearchTermsIncludes: ['螺絲'],
    notes: '304 vs 316 螺絲比較，COMPARISON_RE 觸發 ProductComparison；負向 lookbehind (?<!差) 確保不誤判 BusinessHours',
  },
  {
    id: 'zh-faq-003',
    query: '不鏽鋼螺絲適合用在沿海環境嗎',
    language: 'zh-TW',
    featureFlags: ZH_TW_FLAGS,
    expectedAction: 'answer',
    expectedQueryType: 'product_lookup',
    expectedSearchTermsIncludes: ['螺絲'],
    notes: '沿海環境適用性查詢；rule-based bigram 可識別「螺絲」，但無法識別三元組「不鏽鋼」',
  },
  {
    id: 'zh-faq-004',
    query: '螺絲規格範圍有哪些',
    language: 'zh-TW',
    featureFlags: ZH_TW_FLAGS,
    expectedAction: 'answer',
    expectedQueryType: 'product_lookup',
    expectedSearchTermsIncludes: ['螺絲'],
    notes: '螺絲規格查詢',
  },
  {
    id: 'zh-faq-005',
    query: '有哪些扣件材質可以選',
    language: 'zh-TW',
    featureFlags: ZH_TW_FLAGS,
    expectedAction: 'answer',
    notes:
      '扣件材質查詢 — rule-based bigram 無法識別「扣件」（未在 PRODUCT_RE），需 Jieba domain dict；' +
      'searchTerms 在 rule-based fallback 下可能為空，不設 expectedSearchTermsIncludes',
  },
  // ── 業務與服務 ─────────────────────────────────────────────────────────────
  {
    id: 'zh-faq-006',
    query: '我要下載產品型錄',
    language: 'zh-TW',
    featureFlags: ZH_TW_FLAGS,
    expectedAction: 'answer',
    expectedQueryType: 'catalog_download',
    expectedSearchTermsIncludes: ['型錄'],
    notes: '型錄下載查詢，hasBusiness(型錄) + isCatalogQuery → CatalogDownload',
  },
  {
    id: 'zh-faq-007',
    query: '你們的聯絡方式',
    language: 'zh-TW',
    featureFlags: ZH_TW_FLAGS,
    expectedAction: 'answer',
    expectedQueryType: 'contact',
    expectedSearchTermsIncludes: ['聯絡'],
    notes: '聯絡方式查詢，hasContact(聯絡) → Contact',
  },
  {
    id: 'zh-faq-008',
    query: '公司地址在哪',
    language: 'zh-TW',
    featureFlags: ZH_TW_FLAGS,
    expectedAction: 'answer',
    expectedQueryType: 'business_hours',
    expectedSearchTermsIncludes: ['地址'],
    notes: '公司地址查詢，BUSINESS_HOURS_RE 含「地址」→ BusinessHours；BUSINESS_RE 亦含「地址」故為 Business token',
  },
  {
    id: 'zh-faq-009',
    query: '營業時間是什麼',
    language: 'zh-TW',
    featureFlags: ZH_TW_FLAGS,
    expectedAction: 'answer',
    expectedQueryType: 'business_hours',
    expectedSearchTermsIncludes: ['營業'],
    notes: '營業時間查詢，BUSINESS_HOURS_RE 含「營業」→ BusinessHours',
  },
  {
    id: 'zh-faq-010',
    query: '如何詢價',
    language: 'zh-TW',
    featureFlags: ZH_TW_FLAGS,
    expectedAction: 'answer',
    expectedQueryType: 'quote_request',
    expectedSearchTermsIncludes: ['詢價'],
    notes: '詢價查詢，hasBusiness(詢價) + 無 catalog pattern → QuoteRequest',
  },
  // ── 產品查詢 ───────────────────────────────────────────────────────────────
  {
    id: 'zh-faq-011',
    query: '客製化螺絲可以做嗎',
    language: 'zh-TW',
    featureFlags: ZH_TW_FLAGS,
    expectedAction: 'answer',
    expectedQueryType: 'product_lookup',
    expectedSearchTermsIncludes: ['螺絲'],
    notes: '客製化螺絲查詢',
  },
  {
    id: 'zh-faq-012',
    query: '有沒有華司產品',
    language: 'zh-TW',
    featureFlags: ZH_TW_FLAGS,
    expectedAction: 'answer',
    expectedQueryType: 'product_lookup',
    expectedSearchTermsIncludes: ['華司'],
    notes: '華司（washer）產品查詢，PRODUCT_RE 含「華司」',
  },
  {
    id: 'zh-faq-013',
    query: '螺帽有哪些類型',
    language: 'zh-TW',
    featureFlags: ZH_TW_FLAGS,
    expectedAction: 'answer',
    expectedQueryType: 'product_lookup',
    expectedSearchTermsIncludes: ['螺帽'],
    notes: '螺帽類型查詢，PRODUCT_RE 含「螺帽」',
  },
  {
    id: 'zh-faq-014',
    query: 'M3 螺絲有嗎',
    language: 'zh-TW',
    featureFlags: ZH_TW_FLAGS,
    expectedAction: 'answer',
    expectedQueryType: 'product_lookup',
    expectedSearchTermsIncludes: ['螺絲', 'M3'],
    notes: 'M3 規格螺絲查詢，同時含 Product token(螺絲) 與 Spec token(M3)',
  },
  {
    id: 'zh-faq-015',
    query: '316 不鏽鋼適合食品環境嗎',
    language: 'zh-TW',
    featureFlags: ZH_TW_FLAGS,
    expectedAction: 'answer',
    expectedSearchTermsIncludes: ['316'],
    notes:
      '316 食品環境適用性，SPEC_RE 可識別「316」，rule-based bigram 無法識別三元組「不鏽鋼」；' +
      '不設 expectedQueryType（product_lookup 需 Jieba 識別 Material token）',
  },
  {
    id: 'zh-faq-016',
    query: '碳鋼跟不鏽鋼怎麼選',
    language: 'zh-TW',
    featureFlags: ZH_TW_FLAGS,
    expectedAction: 'answer',
    expectedQueryType: 'product_lookup',
    expectedSearchTermsIncludes: ['碳鋼'],
    notes: '材質選型查詢，MATERIAL_RE 含「碳鋼」→ hasMaterial → ProductLookup；「怎麼選」不在 COMPARISON_RE',
  },
  {
    id: 'zh-faq-017',
    query: '有沒有屋頂螺絲',
    language: 'zh-TW',
    featureFlags: ZH_TW_FLAGS,
    expectedAction: 'answer',
    expectedQueryType: 'product_lookup',
    expectedSearchTermsIncludes: ['螺絲'],
    notes: '屋頂螺絲查詢，bigram「螺絲」→ Product',
  },
  {
    id: 'zh-faq-018',
    query: '有沒有木螺絲',
    language: 'zh-TW',
    featureFlags: ZH_TW_FLAGS,
    expectedAction: 'answer',
    expectedQueryType: 'product_lookup',
    expectedSearchTermsIncludes: ['螺絲'],
    notes: '木螺絲查詢，bigram「螺絲」→ Product',
  },
  {
    id: 'zh-faq-019',
    query: '可以提供報價嗎',
    language: 'zh-TW',
    featureFlags: ZH_TW_FLAGS,
    expectedAction: 'answer',
    expectedQueryType: 'quote_request',
    expectedSearchTermsIncludes: ['報價'],
    notes: '報價查詢，BUSINESS_RE 含「報價」→ QuoteRequest',
  },
  // ── 補充 FAQ ───────────────────────────────────────────────────────────────
  {
    id: 'zh-faq-020',
    query: '鍍鋅螺絲適合戶外使用嗎',
    language: 'zh-TW',
    featureFlags: ZH_TW_FLAGS,
    expectedAction: 'answer',
    expectedQueryType: 'product_lookup',
    expectedSearchTermsIncludes: ['螺絲'],
    notes: '鍍鋅螺絲戶外使用查詢；MATERIAL_RE 含「鍍鋅」，bigram「螺絲」→ Product；第 20 條補充 FAQ',
  },
];
