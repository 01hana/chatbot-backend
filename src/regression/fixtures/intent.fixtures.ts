/**
 * intent.fixtures.ts — Intent detection golden fixtures (RG-002)
 *
 * Covers 5 intent types × 2–3 query variants.
 * Used by `intent.regression.spec.ts` to verify IntentService.detect()
 * accuracy (target ≥ 85% overall).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  Seeded intent templates (from intent-templates.seed.ts):               │
 * │   product-inquiry  — keywords: 產品, 型號, 規格, 尺寸, 材質, product…  │
 * │   product-diagnosis — keywords: 問題, 故障, 異常, issue, broken…       │
 * │   price-inquiry    — keywords: 價格, 報價, 多少錢, price, quote…       │
 * │   general-faq      — keywords: 如何, 怎麼, 什麼是, how to, what is…   │
 * │  (contact-inquiry not in seed; expect null / general-faq fallback)     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

export interface IntentFixture {
  query: string;
  language: string;
  /**
   * Expected `intentLabel` from `IntentService.detect()`.
   * `null` means no template should match (Layer 3 fallback).
   */
  expectedIntent: string | null;
  /** Minimum acceptable confidence (0–1). */
  minConfidence: number;
}

export const INTENT_FIXTURES: IntentFixture[] = [
  // ── product-inquiry ──────────────────────────────────────────────────────
  {
    query: '請問這個螺絲的規格是什麼',
    language: 'zh-TW',
    expectedIntent: 'product-inquiry',
    minConfidence: 0.8,
  },
  {
    query: '我想了解 M3 螺絲的尺寸',
    language: 'zh-TW',
    expectedIntent: 'product-inquiry',
    minConfidence: 0.8,
  },
  {
    query: 'What product models are available?',
    language: 'en',
    expectedIntent: 'product-inquiry',
    minConfidence: 0.8,
  },

  // ── product-diagnosis ────────────────────────────────────────────────────
  {
    query: '螺絲一直鬆脫是什麼問題',
    language: 'zh-TW',
    expectedIntent: 'product-diagnosis',
    minConfidence: 0.8,
  },
  {
    query: '設備螺絲出現異常鬆動',
    language: 'zh-TW',
    expectedIntent: 'product-diagnosis',
    minConfidence: 0.8,
  },
  {
    query: 'The bolt is broken and keeps failing',
    language: 'en',
    expectedIntent: 'product-diagnosis',
    minConfidence: 0.8,
  },

  // ── price-inquiry ─────────────────────────────────────────────────────────
  {
    query: '想詢問不鏽鋼螺絲的報價',
    language: 'zh-TW',
    expectedIntent: 'price-inquiry',
    minConfidence: 0.8,
  },
  {
    query: 'Can you provide a price quote for wire?',
    language: 'en',
    expectedIntent: 'price-inquiry',
    minConfidence: 0.8,
  },

  // ── general-faq ───────────────────────────────────────────────────────────
  {
    query: '如何選擇適合的螺絲',
    language: 'zh-TW',
    expectedIntent: 'general-faq',
    minConfidence: 0.8,
  },
  {
    query: 'What is the difference between carbon steel and alloy steel?',
    language: 'en',
    expectedIntent: 'general-faq',
    minConfidence: 0.8,
  },

  // ── no-match (Layer 3 fallback) ───────────────────────────────────────────
  {
    query: '你們幾點上班',
    language: 'zh-TW',
    expectedIntent: null,
    minConfidence: 0,
  },
  {
    query: 'Please send me your catalog',
    language: 'en',
    // 'catalog' is not a keyword in any template — expected null
    expectedIntent: null,
    minConfidence: 0,
  },
];

// ── Contact inquiry helper (for documentation; not seeded as a template) ──
// The 'contact-inquiry' intent is not in intent-templates.seed.ts.
// Queries about contact info should be retrieved from the 'contact-inquiry'
// knowledge entry via retrieval, not via intent routing.
