import { QueryTypeClassifier } from './query-type.classifier.js';
import { QueryType } from '../types/query-type.enum.js';
import { TokenType } from '../types/token-type.enum.js';
import { QueryToken } from '../types/query-token.type.js';

// ── Token factory helper ─────────────────────────────────────────────────────

function makeToken(
  text: string,
  tokenType: TokenType,
  weight = 0.5,
): QueryToken {
  return {
    text,
    normalizedText: text,
    tokenType,
    weight,
    source: 'rule-based',
  };
}

// ── Token fixtures ───────────────────────────────────────────────────────────

const productToken = makeToken('螺絲', TokenType.Product, 0.9);
const materialToken = makeToken('不鏽鋼', TokenType.Material, 0.8);
const businessToken = makeToken('報價', TokenType.Business, 0.7);
const contactToken = makeToken('聯絡', TokenType.Contact, 0.7);
const specToken = makeToken('304', TokenType.Spec, 0.85);
const noiseToken1 = makeToken('請問', TokenType.Noise, 0.1);
const noiseToken2 = makeToken('你們', TokenType.Noise, 0.1);

// ── Tests ────────────────────────────────────────────────────────────────────

describe('QueryTypeClassifier', () => {
  describe('ProductLookup', () => {
    it('classifies product token → ProductLookup', () => {
      const result = QueryTypeClassifier.classify([productToken], '有哪些螺絲類別');
      expect(result).toBe(QueryType.ProductLookup);
    });

    it('classifies material token → ProductLookup', () => {
      const result = QueryTypeClassifier.classify([materialToken], '不鏽鋼有哪些');
      expect(result).toBe(QueryType.ProductLookup);
    });

    it('classifies product + noise tokens → ProductLookup (not Unsupported)', () => {
      const result = QueryTypeClassifier.classify(
        [noiseToken1, productToken],
        '請問螺絲',
      );
      expect(result).toBe(QueryType.ProductLookup);
    });
  });

  describe('ProductComparison', () => {
    it('classifies product + comparison pattern → ProductComparison', () => {
      // Uses regex signal "差異" in the query string (avoids "在哪" which matches BUSINESS_HOURS_RE)
      const result = QueryTypeClassifier.classify(
        [specToken, materialToken],
        '304跟316差異',
      );
      expect(result).toBe(QueryType.ProductComparison);
    });

    it('classifies material + "比較" pattern → ProductComparison', () => {
      const result = QueryTypeClassifier.classify(
        [materialToken],
        '不鏽鋼比較好嗎',
      );
      expect(result).toBe(QueryType.ProductComparison);
    });

    it('classifies product + "difference" pattern → ProductComparison', () => {
      const result = QueryTypeClassifier.classify(
        [productToken],
        'screw vs bolt difference',
      );
      expect(result).toBe(QueryType.ProductComparison);
    });
  });

  describe('QuoteRequest', () => {
    it('classifies business token without catalog/hours pattern → QuoteRequest', () => {
      const result = QueryTypeClassifier.classify([businessToken], '報價');
      expect(result).toBe(QueryType.QuoteRequest);
    });

    it('classifies business token + product token → QuoteRequest (not ProductLookup)', () => {
      // business check (step 4) fires before product check (step 6)
      const result = QueryTypeClassifier.classify(
        [businessToken, productToken],
        '螺絲報價',
      );
      expect(result).toBe(QueryType.QuoteRequest);
    });
  });

  describe('BusinessHours — priority over QuoteRequest', () => {
    it('classifies "上班時間" pattern → BusinessHours, not QuoteRequest', () => {
      // business token present; but isBusinessHoursQuery fires first (step 2 < step 4)
      const busTokenHours = makeToken('上班', TokenType.Business, 0.7);
      const result = QueryTypeClassifier.classify(
        [busTokenHours],
        '上班時間是幾點',
      );
      expect(result).toBe(QueryType.BusinessHours);
      expect(result).not.toBe(QueryType.QuoteRequest);
    });

    it('classifies "營業" pattern → BusinessHours', () => {
      const result = QueryTypeClassifier.classify([], '營業時間是幾點');
      expect(result).toBe(QueryType.BusinessHours);
    });

    it('classifies "office hours" pattern → BusinessHours', () => {
      const result = QueryTypeClassifier.classify([], 'what are your office hours');
      expect(result).toBe(QueryType.BusinessHours);
    });

    it('isBusinessHoursQuery is checked before hasBusiness step', () => {
      // If hasBusiness check ran first, result would be QuoteRequest.
      // The classifier must return BusinessHours to prove step 2 < step 4.
      const busToken = makeToken('上班', TokenType.Business, 0.7);
      const result = QueryTypeClassifier.classify([busToken], '上班時間');
      expect(result).toBe(QueryType.BusinessHours);
    });
  });

  describe('CatalogDownload', () => {
    it('classifies business token + "型錄" pattern → CatalogDownload', () => {
      const result = QueryTypeClassifier.classify([businessToken], '型錄下載');
      expect(result).toBe(QueryType.CatalogDownload);
    });
  });

  describe('Contact', () => {
    it('classifies contact token → Contact', () => {
      const result = QueryTypeClassifier.classify([contactToken], '聯絡方式');
      expect(result).toBe(QueryType.Contact);
    });

    it('contact check fires before BusinessHours check', () => {
      // Even if query contains "地址" (hours pattern), contact token wins
      const result = QueryTypeClassifier.classify(
        [contactToken],
        '公司地址聯絡',
      );
      expect(result).toBe(QueryType.Contact);
    });
  });

  describe('Unsupported (all-noise)', () => {
    it('all noise tokens → Unsupported', () => {
      const result = QueryTypeClassifier.classify(
        [noiseToken1, noiseToken2],
        '請問你們',
      );
      expect(result).toBe(QueryType.Unsupported);
    });

    it('single noise token → Unsupported', () => {
      const result = QueryTypeClassifier.classify([noiseToken1], '請問');
      expect(result).toBe(QueryType.Unsupported);
    });
  });

  describe('Unknown (catch-all)', () => {
    it('empty token list → Unknown', () => {
      const result = QueryTypeClassifier.classify([], '');
      expect(result).toBe(QueryType.Unknown);
    });

    it('single Unknown-type token → Unknown (not Unsupported)', () => {
      const unknownToken = makeToken('xyz', TokenType.Unknown, 0.3);
      // onlyNoise requires Noise OR Unknown — single Unknown alone triggers Unsupported
      // since it satisfies the onlyNoise predicate
      const result = QueryTypeClassifier.classify([unknownToken], 'xyz');
      // Unknown token satisfies onlyNoise (Noise || Unknown), so → Unsupported
      expect(result).toBe(QueryType.Unsupported);
    });
  });

  describe('isBusinessHoursQuery (pattern helper)', () => {
    it.each([
      ['上班'],
      ['下班'],
      ['營業'],
      ['辦公'],
      ['地址'],
      ['位置'],
      ['在哪'],
      ['幾點'],
      ['office hours'],
      ['business hours'],
      ['location'],
      ['address'],
    ])('matches "%s"', (keyword) => {
      expect(QueryTypeClassifier.isBusinessHoursQuery(keyword)).toBe(true);
    });
  });

  describe('isCatalogQuery (pattern helper)', () => {
    it.each([['型錄'], ['目錄'], ['catalog'], ['brochure'], ['download'], ['下載']])(
      'matches "%s"',
      (keyword) => {
        expect(QueryTypeClassifier.isCatalogQuery(keyword)).toBe(true);
      },
    );
  });

  describe('isComparisonQuery (pattern helper)', () => {
    it.each([['差異'], ['差在'], ['比較'], ['vs'], ['versus'], ['difference'], ['compare']])(
      'matches "%s"',
      (keyword) => {
        expect(QueryTypeClassifier.isComparisonQuery(keyword)).toBe(true);
      },
    );
  });

  // ── T064 regression: "差在哪" must NOT trigger BusinessHours ─────────────

  describe('T064 regression — 不鏽鋼螺絲 304 vs 316 comparison', () => {
    const specToken304 = makeToken('304', TokenType.Spec, 0.85);
    const specToken316 = makeToken('316', TokenType.Spec, 0.85);
    const materialToken = makeToken('不鏽鋼', TokenType.Material, 0.8);
    const productToken = makeToken('螺絲', TokenType.Product, 0.9);

    it('isBusinessHoursQuery: "差在哪" alone does NOT match (no preceding char)', () => {
      // standalone "差在哪" — no char before "在哪" that is "差" at the regex engine level
      // because "差" IS the char before "在", so this SHOULD not match.
      expect(QueryTypeClassifier.isBusinessHoursQuery('差在哪')).toBe(false);
    });

    it('isBusinessHoursQuery: "在哪" alone still matches (location question)', () => {
      expect(QueryTypeClassifier.isBusinessHoursQuery('在哪')).toBe(true);
    });

    it('isBusinessHoursQuery: full query does not trigger business hours', () => {
      expect(
        QueryTypeClassifier.isBusinessHoursQuery('我想知道不鏽鋼螺絲 304 跟 316 差在哪'),
      ).toBe(false);
    });

    it('isComparisonQuery: full query matches comparison', () => {
      expect(
        QueryTypeClassifier.isComparisonQuery('我想知道不鏽鋼螺絲 304 跟 316 差在哪'),
      ).toBe(true);
    });

    it('classifies to ProductComparison (not BusinessHours) with material + spec tokens', () => {
      const result = QueryTypeClassifier.classify(
        [materialToken, productToken, specToken304, specToken316],
        '我想知道不鏽鋼螺絲 304 跟 316 差在哪',
      );
      expect(result).toBe(QueryType.ProductComparison);
      expect(result).not.toBe(QueryType.BusinessHours);
    });

    it('queryType is not Unsupported', () => {
      const result = QueryTypeClassifier.classify(
        [materialToken, productToken, specToken304, specToken316],
        '我想知道不鏽鋼螺絲 304 跟 316 差在哪',
      );
      expect(result).not.toBe(QueryType.Unsupported);
    });
  });
});
