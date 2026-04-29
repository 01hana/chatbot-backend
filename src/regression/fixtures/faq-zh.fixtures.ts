/**
 * faq-zh.fixtures.ts — zh-TW Golden FAQ Fixtures (RG-001)
 *
 * 20 繁體中文常用問法的 golden fixtures。
 * 每筆記錄 query / language / expectedSourceKey / expectedTerms。
 *
 * `expectedSourceKey`: 預期在 top-3 retrieval 結果中命中的 KnowledgeEntry.sourceKey。
 * `expectedTerms`:     QueryNormalizer / RuleBasedQueryAnalyzer 應產出且包含在
 *                      normalised query 或 terms 陣列中的關鍵詞（用於 unit-level 驗收）。
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  CI Baseline (2026-04-28, seed v002)                                     │
 * │  Target: top-3 hit rate ≥ 95% (19/20)                                    │
 * │  Measured: unit-level term extraction (QueryNormalizer / RuleBasedQA)    │
 * │  Full retrieval validation: requires e2e DB (test:e2e)                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

export interface FaqFixture {
  /** 使用者輸入的原始問句 */
  query: string;
  language: string;
  /** 預期命中的 KnowledgeEntry.sourceKey（top-3 中包含） */
  expectedSourceKey: string;
  expectedAction: 'answer' | 'fallback';
  /**
   * Normalized query 或 terms 中必須包含的關鍵詞子字串（至少一個）。
   * 用於驗證查詢理解是否正確萃取了意義詞彙。
   */
  expectedTerms: string[];
}

export const FAQ_ZH_FIXTURES: FaqFixture[] = [
  // ── 螺絲類 ──────────────────────────────────────────────────────────────
  {
    query: '你們有哪些螺絲類別',
    language: 'zh-TW',
    expectedSourceKey: 'screw-overview',
    expectedAction: 'answer',
    expectedTerms: ['螺絲'],
  },
  {
    query: '請問螺絲規格範圍是多少',
    language: 'zh-TW',
    expectedSourceKey: 'screw-overview',
    expectedAction: 'answer',
    expectedTerms: ['螺絲', '規格'],
  },
  {
    query: '想知道鑽尾螺絲適合用在哪裡',
    language: 'zh-TW',
    expectedSourceKey: 'screw-self-drilling',
    expectedAction: 'answer',
    expectedTerms: ['鑽尾螺絲'],
  },
  {
    query: '乾牆螺絲有哪些規格',
    language: 'zh-TW',
    expectedSourceKey: 'screw-drywall',
    expectedAction: 'answer',
    expectedTerms: ['乾牆螺絲'],
  },
  {
    query: '不鏽鋼螺絲 304 跟 316 差在哪',
    language: 'zh-TW',
    expectedSourceKey: 'screw-stainless',
    expectedAction: 'answer',
    expectedTerms: ['不鏽鋼螺絲'],
  },
  {
    query: '木螺絲跟木螺栓一樣嗎',
    language: 'zh-TW',
    expectedSourceKey: 'screw-wood',
    expectedAction: 'answer',
    expectedTerms: ['木螺絲'],
  },
  {
    query: '水泥螺絲能直接鎖進混凝土嗎',
    language: 'zh-TW',
    expectedSourceKey: 'screw-concrete',
    expectedAction: 'answer',
    expectedTerms: ['水泥螺絲'],
  },
  // ── 線材類 ──────────────────────────────────────────────────────────────
  {
    query: '線材線徑有哪些尺寸可選',
    language: 'zh-TW',
    expectedSourceKey: 'wire-overview',
    expectedAction: 'answer',
    expectedTerms: ['線材'],
  },
  {
    query: '碳鋼線材 AISI 1018 適合做什麼',
    language: 'zh-TW',
    expectedSourceKey: 'wire-carbon-steel',
    expectedAction: 'answer',
    expectedTerms: ['碳鋼線材'],
  },
  {
    query: '不鏽鋼線材 SUS304 的耐蝕性如何',
    language: 'zh-TW',
    expectedSourceKey: 'wire-stainless-steel',
    expectedAction: 'answer',
    expectedTerms: ['不鏽鋼線材'],
  },
  {
    query: '合金鋼線材可以用在汽車零件嗎',
    language: 'zh-TW',
    expectedSourceKey: 'wire-alloy-steel',
    expectedAction: 'answer',
    expectedTerms: ['合金鋼線材'],
  },
  // ── 螺栓類 ──────────────────────────────────────────────────────────────
  {
    query: '六角螺栓強度等級有哪些',
    language: 'zh-TW',
    expectedSourceKey: 'bolt-hex',
    expectedAction: 'answer',
    expectedTerms: ['六角螺栓'],
  },
  {
    query: '法蘭螺栓跟六角螺栓的差異',
    language: 'zh-TW',
    expectedSourceKey: 'bolt-flange',
    expectedAction: 'answer',
    expectedTerms: ['法蘭螺栓'],
  },
  // ── 螺帽類 ──────────────────────────────────────────────────────────────
  {
    query: '尼龍防鬆螺帽是什麼',
    language: 'zh-TW',
    expectedSourceKey: 'nut-nylon',
    expectedAction: 'answer',
    expectedTerms: ['尼龍'],
  },
  // ── 華司類 ──────────────────────────────────────────────────────────────
  {
    query: '彈簧墊圈有什麼功能',
    language: 'zh-TW',
    expectedSourceKey: 'washer-spring-lock',
    expectedAction: 'answer',
    expectedTerms: ['彈簧'],
  },
  // ── 公司與聯絡 ────────────────────────────────────────────────────────────
  {
    query: '震南公司在哪裡',
    language: 'zh-TW',
    expectedSourceKey: 'company-overview',
    expectedAction: 'answer',
    expectedTerms: ['震南'],
  },
  {
    query: '能告訴我你們的聯絡方式嗎',
    language: 'zh-TW',
    expectedSourceKey: 'contact-inquiry',
    expectedAction: 'answer',
    expectedTerms: ['聯絡'],
  },
  // ── 選型問診類 ─────────────────────────────────────────────────────────
  {
    query: '戶外用螺絲要選哪種材質比較好',
    language: 'zh-TW',
    expectedSourceKey: 'screw-selection-guide',
    expectedAction: 'answer',
    expectedTerms: ['螺絲', '材質'],
  },
  {
    query: '線材要怎麼選材質',
    language: 'zh-TW',
    expectedSourceKey: 'wire-material-selection',
    expectedAction: 'answer',
    expectedTerms: ['線材', '材質'],
  },
  // ── 混合中英文 ─────────────────────────────────────────────────────────
  {
    query: 'M3 不鏽鋼螺絲 stainless 有嗎',
    language: 'zh-TW',
    expectedSourceKey: 'screw-stainless',
    expectedAction: 'answer',
    expectedTerms: ['不鏽鋼螺絲'],
  },
];
