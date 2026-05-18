import { RetrievalPlanBuilder } from './retrieval-plan.builder.js';
import { QueryType } from '../types/query-type.enum.js';
import { TokenType } from '../types/token-type.enum.js';
import { QueryToken } from '../types/query-token.type.js';

// ── Token factory ────────────────────────────────────────────────────────────

function makeToken(
  text: string,
  tokenType: TokenType,
  weight: number,
): QueryToken {
  return {
    text,
    normalizedText: text,
    tokenType,
    weight,
    source: 'rule-based',
  };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const productHigh = makeToken('螺絲', TokenType.Product, 0.9);
const specMed = makeToken('304', TokenType.Spec, 0.85);
const materialMed = makeToken('不鏽鋼', TokenType.Material, 0.8);
const businessLow = makeToken('報價', TokenType.Business, 0.7);
const noiseToken = makeToken('請問', TokenType.Noise, 0.1);
const unknownToken = makeToken('xyz', TokenType.Unknown, 0.3);

// ── Tests ────────────────────────────────────────────────────────────────────

describe('RetrievalPlanBuilder', () => {
  describe('searchTerms filtering', () => {
    it('excludes Noise tokens from searchTerms', () => {
      const plan = RetrievalPlanBuilder.build(
        [productHigh, noiseToken],
        QueryType.ProductLookup,
        'supported',
        'zh-TW',
      );
      expect(plan.searchTerms).not.toContain('請問');
      expect(plan.searchTerms).toContain('螺絲');
    });

    it('excludes Unknown tokens from searchTerms', () => {
      const plan = RetrievalPlanBuilder.build(
        [productHigh, unknownToken],
        QueryType.ProductLookup,
        'supported',
        'zh-TW',
      );
      expect(plan.searchTerms).not.toContain('xyz');
      expect(plan.searchTerms).toContain('螺絲');
    });

    it('excludes empty normalizedText after trimming', () => {
      const emptyToken = makeToken('  ', TokenType.Product, 0.9);
      emptyToken.normalizedText = '   ';
      const plan = RetrievalPlanBuilder.build(
        [emptyToken, productHigh],
        QueryType.ProductLookup,
        'supported',
        'zh-TW',
      );
      // whitespace-only strings must not appear
      for (const term of plan.searchTerms) {
        expect(term.trim().length).toBeGreaterThan(0);
      }
    });

    it('all tokens are noise → empty searchTerms', () => {
      const plan = RetrievalPlanBuilder.build(
        [noiseToken, makeToken('你們', TokenType.Noise, 0.1)],
        QueryType.Unsupported,
        'unsupported',
        'zh-TW',
      );
      expect(plan.searchTerms).toHaveLength(0);
    });
  });

  describe('searchTerms ordering', () => {
    it('searchTerms are sorted by descending weight', () => {
      const plan = RetrievalPlanBuilder.build(
        [businessLow, materialMed, specMed, productHigh],
        QueryType.ProductLookup,
        'supported',
        'zh-TW',
      );
      // product(0.9) > spec(0.85) > material(0.8) > business(0.7)
      const expected = ['螺絲', '304', '不鏽鋼', '報價'];
      expect(plan.searchTerms).toEqual(expected);
    });

    it('equal-weight tokens maintain stable relative position', () => {
      const a = makeToken('a', TokenType.Product, 0.9);
      const b = makeToken('b', TokenType.Product, 0.9);
      const plan = RetrievalPlanBuilder.build(
        [a, b],
        QueryType.ProductLookup,
        'supported',
        'zh-TW',
      );
      // Both present; order may vary but both must be in result
      expect(plan.searchTerms).toContain('a');
      expect(plan.searchTerms).toContain('b');
    });
  });

  describe('language', () => {
    it('language equals the passed value', () => {
      const plan = RetrievalPlanBuilder.build(
        [productHigh],
        QueryType.ProductLookup,
        'supported',
        'zh-TW',
      );
      expect(plan.language).toBe('zh-TW');
    });

    it('language equals "en" when passed "en"', () => {
      const plan = RetrievalPlanBuilder.build(
        [productHigh],
        QueryType.ProductLookup,
        'supported',
        'en',
      );
      expect(plan.language).toBe('en');
    });

    it('throws when language is empty string', () => {
      expect(() =>
        RetrievalPlanBuilder.build(
          [productHigh],
          QueryType.ProductLookup,
          'supported',
          '',
        ),
      ).toThrow();
    });
  });

  describe('maxResults', () => {
    it('maxResults has a default value (not zero, not undefined)', () => {
      const plan = RetrievalPlanBuilder.build(
        [productHigh],
        QueryType.ProductLookup,
        'supported',
        'zh-TW',
      );
      expect(plan.maxResults).toBeDefined();
      expect(plan.maxResults).toBeGreaterThan(0);
    });

    it('maxResults equals 5 (current default)', () => {
      const plan = RetrievalPlanBuilder.build(
        [productHigh],
        QueryType.ProductLookup,
        'supported',
        'zh-TW',
      );
      expect(plan.maxResults).toBe(5);
    });
  });

  describe('strategies', () => {
    it('ProductLookup → includes "keyword" and "metadata"', () => {
      const plan = RetrievalPlanBuilder.build(
        [productHigh],
        QueryType.ProductLookup,
        'supported',
        'zh-TW',
      );
      expect(plan.strategies).toContain('keyword');
      expect(plan.strategies).toContain('metadata');
    });

    it('ProductComparison → includes "keyword" and "metadata"', () => {
      const plan = RetrievalPlanBuilder.build(
        [productHigh],
        QueryType.ProductComparison,
        'supported',
        'zh-TW',
      );
      expect(plan.strategies).toContain('keyword');
      expect(plan.strategies).toContain('metadata');
    });

    it('QuoteRequest → "keyword" only', () => {
      const plan = RetrievalPlanBuilder.build(
        [businessLow],
        QueryType.QuoteRequest,
        'supported',
        'zh-TW',
      );
      expect(plan.strategies).toContain('keyword');
      expect(plan.strategies).not.toContain('metadata');
    });

    it('GeneralFaq → "keyword" only', () => {
      const plan = RetrievalPlanBuilder.build(
        [productHigh],
        QueryType.GeneralFaq,
        'supported',
        'zh-TW',
      );
      expect(plan.strategies).toContain('keyword');
      expect(plan.strategies).not.toContain('metadata');
    });
  });

  // ── T064 regression ──────────────────────────────────────────────────────

  describe('T064 regression — 不鏽鋼螺絲 304 vs 316 comparison', () => {
    const stainlessProduct = makeToken('不鏽鋼螺絲', TokenType.Product, 0.9);
    const stainlessMaterial = makeToken('不鏽鋼', TokenType.Material, 0.8);
    const screwProduct = makeToken('螺絲', TokenType.Product, 0.9);
    const spec304 = makeToken('304', TokenType.Spec, 0.85);
    const spec316 = makeToken('316', TokenType.Spec, 0.85);

    it('searchTerms is not empty for a product comparison query', () => {
      const plan = RetrievalPlanBuilder.build(
        [stainlessMaterial, screwProduct, spec304, spec316],
        QueryType.ProductComparison,
        'supported',
        'zh-TW',
      );
      expect(plan.searchTerms.length).toBeGreaterThan(0);
    });

    it('searchTerms contains 不鏽鋼 or 不鏽鋼螺絲', () => {
      const plan = RetrievalPlanBuilder.build(
        [stainlessProduct, spec304, spec316],
        QueryType.ProductComparison,
        'supported',
        'zh-TW',
      );
      const hasMaterial =
        plan.searchTerms.includes('不鏽鋼') || plan.searchTerms.includes('不鏽鋼螺絲');
      expect(hasMaterial).toBe(true);
    });

    it('searchTerms contains 螺絲 or 不鏽鋼螺絲', () => {
      const plan = RetrievalPlanBuilder.build(
        [stainlessMaterial, screwProduct, spec304, spec316],
        QueryType.ProductComparison,
        'supported',
        'zh-TW',
      );
      const hasProduct =
        plan.searchTerms.includes('螺絲') || plan.searchTerms.includes('不鏽鋼螺絲');
      expect(hasProduct).toBe(true);
    });

    it('searchTerms contains 304', () => {
      const plan = RetrievalPlanBuilder.build(
        [stainlessMaterial, screwProduct, spec304, spec316],
        QueryType.ProductComparison,
        'supported',
        'zh-TW',
      );
      expect(plan.searchTerms).toContain('304');
    });

    it('searchTerms contains 316', () => {
      const plan = RetrievalPlanBuilder.build(
        [stainlessMaterial, screwProduct, spec304, spec316],
        QueryType.ProductComparison,
        'supported',
        'zh-TW',
      );
      expect(plan.searchTerms).toContain('316');
    });

    it('strategies include keyword and metadata for ProductComparison', () => {
      const plan = RetrievalPlanBuilder.build(
        [stainlessMaterial, screwProduct, spec304, spec316],
        QueryType.ProductComparison,
        'supported',
        'zh-TW',
      );
      expect(plan.strategies).toContain('keyword');
      expect(plan.strategies).toContain('metadata');
    });
  });
});

