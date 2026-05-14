import { SupportabilityClassifier } from './supportability.classifier.js';
import { KnowledgeAvailabilityChecker } from './knowledge-availability-checker.js';
import { QueryType } from '../types/query-type.enum.js';
import { TokenType } from '../types/token-type.enum.js';
import { QueryToken } from '../types/query-token.type.js';

// ── Token factory ────────────────────────────────────────────────────────────

function makeToken(text: string, tokenType: TokenType): QueryToken {
  return {
    text,
    normalizedText: text,
    tokenType,
    weight: 0.5,
    source: 'rule-based',
  };
}

// ── Mock factory ─────────────────────────────────────────────────────────────

function makeAvailabilityChecker(hasContent: boolean): KnowledgeAvailabilityChecker {
  return {
    hasContentFor: jest.fn().mockResolvedValue(hasContent),
    clearCache: jest.fn(),
  } as unknown as KnowledgeAvailabilityChecker;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('SupportabilityClassifier', () => {
  const noiseToken = makeToken('請問', TokenType.Noise);
  const unknownToken = makeToken('xyz', TokenType.Unknown);
  const productToken = makeToken('螺絲', TokenType.Product);

  describe('Rule 1 — all tokens are noise', () => {
    it('all-noise tokens → unsupported, reason=all_tokens_noise', async () => {
      const checker = makeAvailabilityChecker(true);
      const classifier = new SupportabilityClassifier(checker);

      const result = await classifier.classify(
        QueryType.ProductLookup,
        [noiseToken, makeToken('你們', TokenType.Noise)],
        'zh-TW',
      );

      expect(result.status).toBe('unsupported');
      expect(result.reason).toBe('all_tokens_noise');
      // KB was not queried — short-circuited early
      expect(checker.hasContentFor).not.toHaveBeenCalled();
    });

    it('single noise token → unsupported, reason=all_tokens_noise', async () => {
      const checker = makeAvailabilityChecker(true);
      const classifier = new SupportabilityClassifier(checker);

      const result = await classifier.classify(
        QueryType.ProductLookup,
        [noiseToken],
        'zh-TW',
      );

      expect(result.status).toBe('unsupported');
      expect(result.reason).toBe('all_tokens_noise');
    });

    it('mixed noise + unknown tokens → unsupported, reason=all_tokens_noise', async () => {
      const checker = makeAvailabilityChecker(true);
      const classifier = new SupportabilityClassifier(checker);

      const result = await classifier.classify(
        QueryType.ProductLookup,
        [noiseToken, unknownToken],
        'zh-TW',
      );

      expect(result.status).toBe('unsupported');
      expect(result.reason).toBe('all_tokens_noise');
    });
  });

  describe('Rule 2 — QueryType.Unsupported', () => {
    it('queryType=Unsupported → unsupported, reason=classifier_unsupported', async () => {
      const checker = makeAvailabilityChecker(true);
      const classifier = new SupportabilityClassifier(checker);

      const result = await classifier.classify(
        QueryType.Unsupported,
        [productToken],
        'zh-TW',
      );

      expect(result.status).toBe('unsupported');
      expect(result.reason).toBe('classifier_unsupported');
      expect(checker.hasContentFor).not.toHaveBeenCalled();
    });
  });

  describe('Rule 2b — QueryType.Unknown', () => {
    it('queryType=Unknown → unsupported, reason=unknown_query_type', async () => {
      const checker = makeAvailabilityChecker(true);
      const classifier = new SupportabilityClassifier(checker);

      const result = await classifier.classify(
        QueryType.Unknown,
        [productToken],
        'zh-TW',
      );

      expect(result.status).toBe('unsupported');
      expect(result.reason).toBe('unknown_query_type');
      expect(checker.hasContentFor).not.toHaveBeenCalled();
    });
  });

  describe('Rule 3 — KB content check', () => {
    it('KB has content → supported', async () => {
      const checker = makeAvailabilityChecker(true);
      const classifier = new SupportabilityClassifier(checker);

      const result = await classifier.classify(
        QueryType.ProductLookup,
        [productToken],
        'zh-TW',
      );

      expect(result.status).toBe('supported');
      expect(result.reason).toBeUndefined();
    });

    it('KB has no content → unsupported, reason contains queryType', async () => {
      const checker = makeAvailabilityChecker(false);
      const classifier = new SupportabilityClassifier(checker);

      const result = await classifier.classify(
        QueryType.ProductLookup,
        [productToken],
        'zh-TW',
      );

      expect(result.status).toBe('unsupported');
      expect(result.reason).toBe(`no_kb_content_for_${QueryType.ProductLookup}`);
    });

    it('KB has no content for BusinessHours → reason contains BusinessHours queryType', async () => {
      const checker = makeAvailabilityChecker(false);
      const classifier = new SupportabilityClassifier(checker);

      const result = await classifier.classify(
        QueryType.BusinessHours,
        [makeToken('上班', TokenType.Business)],
        'zh-TW',
      );

      expect(result.status).toBe('unsupported');
      expect(result.reason).toBe(`no_kb_content_for_${QueryType.BusinessHours}`);
    });
  });

  describe('language forwarding', () => {
    it('passes language correctly to hasContentFor', async () => {
      const checker = makeAvailabilityChecker(true);
      const classifier = new SupportabilityClassifier(checker);

      await classifier.classify(
        QueryType.ProductLookup,
        [productToken],
        'en',
      );

      expect(checker.hasContentFor).toHaveBeenCalledWith(QueryType.ProductLookup, 'en');
    });

    it('passes zh-TW language correctly to hasContentFor', async () => {
      const checker = makeAvailabilityChecker(true);
      const classifier = new SupportabilityClassifier(checker);

      // Use a non-noise, non-unknown token so Rule 1 (all-noise) does not fire
      await classifier.classify(
        QueryType.GeneralFaq,
        [makeToken('常見', TokenType.Action)],
        'zh-TW',
      );

      expect(checker.hasContentFor).toHaveBeenCalledWith(QueryType.GeneralFaq, 'zh-TW');
    });
  });

  describe('empty token list', () => {
    it('empty tokens + supported queryType → supported (no noise rule triggered)', async () => {
      // all-noise rule requires tokens.length > 0
      const checker = makeAvailabilityChecker(true);
      const classifier = new SupportabilityClassifier(checker);

      const result = await classifier.classify(
        QueryType.GeneralFaq,
        [],
        'zh-TW',
      );

      expect(result.status).toBe('supported');
    });
  });
});
