import { QueryUnderstandingService } from './query-understanding.service.js';
import { TokenizerProviderService } from './tokenizers/tokenizer-provider.service.js';
import { SupportabilityClassifier } from './classifiers/supportability.classifier.js';
import { QueryType } from './types/query-type.enum.js';
import { TokenType } from './types/token-type.enum.js';
import { QueryToken } from './types/query-token.type.js';
import { ITokenizer } from './tokenizers/tokenizer.interface.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeToken(
  text: string,
  tokenType: TokenType,
  weight: number,
): QueryToken {
  return { text, normalizedText: text, tokenType, weight, source: 'rule-based' };
}

function makeFakeTokenizer(tokens: QueryToken[]): ITokenizer {
  return {
    tokenize: jest.fn().mockResolvedValue(tokens),
  };
}

function makeFakeThrowingTokenizer(): ITokenizer {
  return {
    tokenize: jest.fn().mockRejectedValue(new Error('Tokenizer init failed')),
  };
}

/**
 * Build a mock TokenizerProviderService.
 *
 * @param tokenizer  The ITokenizer to return from getTokenizer().
 * @param name       The name returned by getLastUsedName().
 */
function makeProviderMock(tokenizer: ITokenizer, name = 'rule-based'): TokenizerProviderService {
  return {
    getTokenizer: jest.fn().mockReturnValue(tokenizer),
    getLastUsedName: jest.fn().mockReturnValue(name),
  } as unknown as TokenizerProviderService;
}

/**
 * Build a mock SupportabilityClassifier.
 */
function makeSupportabilityMock(
  status: 'supported' | 'unsupported' | 'unknown',
  reason?: string,
): SupportabilityClassifier {
  return {
    classify: jest.fn().mockResolvedValue({ status, reason }),
  } as unknown as SupportabilityClassifier;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('QueryUnderstandingService', () => {
  // ── Basic contract ─────────────────────────────────────────────────────

  describe('understand() — basic output contract', () => {
    it('returns a result with language equal to the passed value', async () => {
      const tokens = [makeToken('螺絲', TokenType.Product, 0.9)];
      const provider = makeProviderMock(makeFakeTokenizer(tokens));
      const supportability = makeSupportabilityMock('supported');
      const service = new QueryUnderstandingService(provider, supportability);

      const result = await service.understand('螺絲', 'zh-TW');

      expect(result.language).toBe('zh-TW');
    });

    it('retrievalPlan.language is not empty', async () => {
      const tokens = [makeToken('螺絲', TokenType.Product, 0.9)];
      const provider = makeProviderMock(makeFakeTokenizer(tokens));
      const supportability = makeSupportabilityMock('supported');
      const service = new QueryUnderstandingService(provider, supportability);

      const result = await service.understand('螺絲', 'zh-TW');

      expect(result.retrievalPlan.language).toBeTruthy();
      expect(result.retrievalPlan.language.length).toBeGreaterThan(0);
    });

    it('tokenizer field equals the name from TokenizerProviderService', async () => {
      const tokens = [makeToken('螺絲', TokenType.Product, 0.9)];
      const provider = makeProviderMock(makeFakeTokenizer(tokens), 'rule-based');
      const supportability = makeSupportabilityMock('supported');
      const service = new QueryUnderstandingService(provider, supportability);

      const result = await service.understand('螺絲', 'zh-TW');

      expect(result.tokenizer).toBe('rule-based');
    });

    it('debugMeta.durationMs is a non-negative number', async () => {
      const tokens = [makeToken('螺絲', TokenType.Product, 0.9)];
      const provider = makeProviderMock(makeFakeTokenizer(tokens));
      const supportability = makeSupportabilityMock('supported');
      const service = new QueryUnderstandingService(provider, supportability);

      const result = await service.understand('螺絲', 'zh-TW');

      expect(result.debugMeta.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ── keyPhrases filtering ────────────────────────────────────────────────

  describe('keyPhrases', () => {
    it('keyPhrases contains only tokens with weight ≥ 0.7 and not Noise', async () => {
      const tokens = [
        makeToken('螺絲', TokenType.Product, 0.9),   // included: product, high weight
        makeToken('304', TokenType.Spec, 0.85),       // included: spec, high weight
        makeToken('請問', TokenType.Noise, 0.1),      // excluded: noise
        makeToken('xyz', TokenType.Unknown, 0.3),     // excluded: low weight
        makeToken('業務', TokenType.Business, 0.7),  // included: weight exactly 0.7
      ];
      const provider = makeProviderMock(makeFakeTokenizer(tokens));
      const supportability = makeSupportabilityMock('supported');
      const service = new QueryUnderstandingService(provider, supportability);

      const result = await service.understand('test', 'zh-TW');

      const keyPhraseTexts = result.keyPhrases.map((t) => t.text);
      expect(keyPhraseTexts).toContain('螺絲');
      expect(keyPhraseTexts).toContain('304');
      expect(keyPhraseTexts).toContain('業務');
      expect(keyPhraseTexts).not.toContain('請問');
      expect(keyPhraseTexts).not.toContain('xyz');
    });

    it('keyPhrases excludes Unknown tokens even if weight ≥ 0.7', async () => {
      const highWeightUnknown = makeToken('???', TokenType.Unknown, 0.8);
      const provider = makeProviderMock(makeFakeTokenizer([highWeightUnknown]));
      const supportability = makeSupportabilityMock('unsupported');
      const service = new QueryUnderstandingService(provider, supportability);

      const result = await service.understand('test', 'zh-TW');

      expect(result.keyPhrases).toHaveLength(0);
    });
  });

  // ── All-noise path ──────────────────────────────────────────────────────

  describe('all-noise query', () => {
    it('all-noise tokens → supportability=unsupported', async () => {
      const tokens = [
        makeToken('請問', TokenType.Noise, 0.1),
        makeToken('你們', TokenType.Noise, 0.1),
      ];
      const provider = makeProviderMock(makeFakeTokenizer(tokens));
      // SupportabilityClassifier will receive QueryType.Unsupported (from QueryTypeClassifier)
      // and return unsupported for all_tokens_noise rule — mock this outcome
      const supportability = makeSupportabilityMock('unsupported', 'all_tokens_noise');
      const service = new QueryUnderstandingService(provider, supportability);

      const result = await service.understand('請問你們', 'zh-TW');

      expect(result.supportability).toBe('unsupported');
    });
  });

  // ── Error resilience ────────────────────────────────────────────────────

  describe('error resilience', () => {
    it('tokenizer failure → safeFallback result (no throw)', async () => {
      const provider = makeProviderMock(makeFakeThrowingTokenizer());
      const supportability = makeSupportabilityMock('supported');
      const service = new QueryUnderstandingService(provider, supportability);

      // Must not throw
      const result = await expect(
        service.understand('螺絲', 'zh-TW'),
      ).resolves.toBeDefined();

      void result;
    });

    it('tokenizer failure → fallback result has unsupported supportability', async () => {
      const provider = makeProviderMock(makeFakeThrowingTokenizer());
      const supportability = makeSupportabilityMock('supported');
      const service = new QueryUnderstandingService(provider, supportability);

      const result = await service.understand('螺絲', 'zh-TW');

      expect(result.supportability).toBe('unsupported');
      expect(result.unsupportedReason).toBe('pipeline_error');
    });

    it('tokenizer failure → fallback retrievalPlan.language is not empty', async () => {
      const provider = makeProviderMock(makeFakeThrowingTokenizer());
      const supportability = makeSupportabilityMock('supported');
      const service = new QueryUnderstandingService(provider, supportability);

      const result = await service.understand('螺絲', 'zh-TW');

      expect(result.retrievalPlan.language).toBeTruthy();
    });

    it('tokenizer failure → fallback queryType is Unknown', async () => {
      const provider = makeProviderMock(makeFakeThrowingTokenizer());
      const supportability = makeSupportabilityMock('supported');
      const service = new QueryUnderstandingService(provider, supportability);

      const result = await service.understand('螺絲', 'zh-TW');

      expect(result.queryType).toBe(QueryType.Unknown);
    });
  });

  // ── Integration: RuleBasedTokenizer (no mocks) ───────────────────────────

  describe('integration with RuleBasedTokenizerAdapter', () => {
    /**
     * Build a real TokenizerProviderService wired for Phase 2, but with
     * SystemConfigService defaulting to 'rule-based' and JiebaTokenizer not
     * ready — so zh-TW still reaches RuleBasedTokenizerAdapter.
     */
    function makeRealProvider(): TokenizerProviderService {
      const mockConfig = {
        getString: jest.fn().mockReturnValue('rule-based'),
      };
      const mockJieba = { isReady: jest.fn().mockReturnValue(false) };
      return new TokenizerProviderService(
        mockConfig as never,
        mockJieba as never,
      );
    }

    /**
     * This test uses real RuleBasedTokenizerAdapter via TokenizerProviderService.
     * SupportabilityClassifier is mocked to avoid DB dependency.
     * Purpose: verify the pipeline wiring produces sensible output.
     */
    it('understand("你們有哪些螺絲類別", "zh-TW") → queryType=ProductLookup, non-empty searchTerms', async () => {
      const realProvider = makeRealProvider();
      const supportabilityMock = makeSupportabilityMock('supported');
      const service = new QueryUnderstandingService(realProvider, supportabilityMock);

      const result = await service.understand('你們有哪些螺絲類別', 'zh-TW');

      expect(result.queryType).toBe(QueryType.ProductLookup);
      expect(result.retrievalPlan.searchTerms.length).toBeGreaterThan(0);
      expect(result.tokenizer).toBe('rule-based');
      expect(result.retrievalPlan.language).toBe('zh-TW');
    });

    it('Phase 2: language="en" uses EnglishTokenizer (tokenizer="english")', async () => {
      const realProvider = makeRealProvider();
      const supportabilityMock = makeSupportabilityMock('supported');
      const service = new QueryUnderstandingService(realProvider, supportabilityMock);

      const result = await service.understand('screw catalog', 'en');

      expect(result.tokenizer).toBe('english');
    });
  });
});
