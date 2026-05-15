import { TokenizerProviderService } from './tokenizer-provider.service.js';
import { RuleBasedTokenizerAdapter } from './rule-based.tokenizer.js';
import { EnglishTokenizer } from './english.tokenizer.js';
import { JiebaTokenizer } from './jieba.tokenizer.js';
import { SystemConfigService } from '../../system-config/system-config.service.js';

// ── Test factory ──────────────────────────────────────────────────────────────

interface ProviderOptions {
  /** Value returned by SystemConfigService.getString('feature.zh_tokenizer', …) */
  zhTokenizer?: string;
  /** Whether JiebaTokenizer.isReady() returns true */
  jiebaReady?: boolean;
  /** Whether SystemConfigService.getString throws */
  configThrows?: boolean;
}

function makeProvider(opts: ProviderOptions = {}): {
  provider: TokenizerProviderService;
  mockConfig: jest.Mocked<Pick<SystemConfigService, 'getString'>>;
  mockJieba: jest.Mocked<Pick<JiebaTokenizer, 'isReady' | 'tokenize'>>;
  loggerWarnSpy: jest.SpyInstance;
} {
  const { zhTokenizer = 'rule-based', jiebaReady = false, configThrows = false } = opts;

  const mockConfig = {
    getString: jest.fn().mockImplementation((key: string, defaultValue: string) => {
      if (configThrows) throw new Error('DB unavailable');
      if (key === 'feature.zh_tokenizer') return zhTokenizer;
      return defaultValue;
    }),
  } as jest.Mocked<Pick<SystemConfigService, 'getString'>>;

  const mockJieba = {
    isReady: jest.fn().mockReturnValue(jiebaReady),
    tokenize: jest.fn().mockResolvedValue([]),
  } as jest.Mocked<Pick<JiebaTokenizer, 'isReady' | 'tokenize'>>;

  const provider = new TokenizerProviderService(
    mockConfig as unknown as SystemConfigService,
    mockJieba as unknown as JiebaTokenizer,
  );

  // Spy on the logger to capture WARN calls without noisy output
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
  const loggerWarnSpy = jest.spyOn((provider as any).logger, 'warn').mockImplementation(() => {});

  return { provider, mockConfig, mockJieba, loggerWarnSpy };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TokenizerProviderService', () => {
  afterEach(() => jest.clearAllMocks());

  // ── language='en' → EnglishTokenizer ─────────────────────────────────────

  describe('language="en"', () => {
    it('returns EnglishTokenizer', () => {
      const { provider } = makeProvider();
      const tokenizer = provider.getTokenizer('en');
      expect(tokenizer).toBeInstanceOf(EnglishTokenizer);
    });

    it('getLastUsedName() returns "english"', () => {
      const { provider } = makeProvider();
      provider.getTokenizer('en');
      expect(provider.getLastUsedName()).toBe('english');
    });

    it('does not consult SystemConfigService for English', () => {
      const { provider, mockConfig } = makeProvider();
      provider.getTokenizer('en');
      expect(mockConfig.getString).not.toHaveBeenCalled();
    });
  });

  // ── feature.zh_tokenizer='rule-based' ────────────────────────────────────

  describe('feature.zh_tokenizer="rule-based"', () => {
    it('returns RuleBasedTokenizerAdapter', () => {
      const { provider } = makeProvider({ zhTokenizer: 'rule-based' });
      const tokenizer = provider.getTokenizer('zh-TW');
      expect(tokenizer).toBeInstanceOf(RuleBasedTokenizerAdapter);
    });

    it('getLastUsedName() returns "rule-based"', () => {
      const { provider } = makeProvider({ zhTokenizer: 'rule-based' });
      provider.getTokenizer('zh-TW');
      expect(provider.getLastUsedName()).toBe('rule-based');
    });

    it('does not emit a WARN', () => {
      const { provider, loggerWarnSpy } = makeProvider({ zhTokenizer: 'rule-based' });
      provider.getTokenizer('zh-TW');
      expect(loggerWarnSpy).not.toHaveBeenCalled();
    });
  });

  // ── feature.zh_tokenizer='jieba', Jieba ready ────────────────────────────

  describe('feature.zh_tokenizer="jieba", jieba ready', () => {
    it('returns JiebaTokenizer', () => {
      const { provider, mockJieba } = makeProvider({ zhTokenizer: 'jieba', jiebaReady: true });
      const tokenizer = provider.getTokenizer('zh-TW');
      expect(tokenizer).toBe(mockJieba as unknown as JiebaTokenizer);
    });

    it('getLastUsedName() returns "jieba"', () => {
      const { provider } = makeProvider({ zhTokenizer: 'jieba', jiebaReady: true });
      provider.getTokenizer('zh-TW');
      expect(provider.getLastUsedName()).toBe('jieba');
    });

    it('does not emit a WARN', () => {
      const { provider, loggerWarnSpy } = makeProvider({
        zhTokenizer: 'jieba',
        jiebaReady: true,
      });
      provider.getTokenizer('zh-TW');
      expect(loggerWarnSpy).not.toHaveBeenCalled();
    });
  });

  // ── feature.zh_tokenizer='jieba', Jieba NOT ready ───────────────────────

  describe('feature.zh_tokenizer="jieba", jieba NOT ready', () => {
    it('returns RuleBasedTokenizerAdapter (fallback)', () => {
      const { provider } = makeProvider({ zhTokenizer: 'jieba', jiebaReady: false });
      const tokenizer = provider.getTokenizer('zh-TW');
      expect(tokenizer).toBeInstanceOf(RuleBasedTokenizerAdapter);
    });

    it('getLastUsedName() returns "rule-based"', () => {
      const { provider } = makeProvider({ zhTokenizer: 'jieba', jiebaReady: false });
      provider.getTokenizer('zh-TW');
      expect(provider.getLastUsedName()).toBe('rule-based');
    });

    it('emits a WARN about Jieba not being ready', () => {
      const { provider, loggerWarnSpy } = makeProvider({
        zhTokenizer: 'jieba',
        jiebaReady: false,
      });
      provider.getTokenizer('zh-TW');
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('not ready'),
      );
    });
  });

  // ── Unknown feature value → fallback + WARN ──────────────────────────────

  describe('unknown feature.zh_tokenizer value', () => {
    it('returns RuleBasedTokenizerAdapter', () => {
      const { provider } = makeProvider({ zhTokenizer: 'unknown-value' });
      const tokenizer = provider.getTokenizer('zh-TW');
      expect(tokenizer).toBeInstanceOf(RuleBasedTokenizerAdapter);
    });

    it('getLastUsedName() returns "rule-based"', () => {
      const { provider } = makeProvider({ zhTokenizer: 'unknown-value' });
      provider.getTokenizer('zh-TW');
      expect(provider.getLastUsedName()).toBe('rule-based');
    });

    it('emits a WARN about unknown value', () => {
      const { provider, loggerWarnSpy } = makeProvider({ zhTokenizer: 'unknown-value' });
      provider.getTokenizer('zh-TW');
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('unknown'),
      );
    });
  });

  // ── SystemConfigService throws ────────────────────────────────────────────

  describe('SystemConfigService read failure', () => {
    it('does not throw', () => {
      const { provider } = makeProvider({ configThrows: true });
      expect(() => provider.getTokenizer('zh-TW')).not.toThrow();
    });

    it('returns RuleBasedTokenizerAdapter', () => {
      const { provider } = makeProvider({ configThrows: true });
      const tokenizer = provider.getTokenizer('zh-TW');
      expect(tokenizer).toBeInstanceOf(RuleBasedTokenizerAdapter);
    });

    it('getLastUsedName() returns "rule-based"', () => {
      const { provider } = makeProvider({ configThrows: true });
      provider.getTokenizer('zh-TW');
      expect(provider.getLastUsedName()).toBe('rule-based');
    });
  });

  // ── getLastUsedName() initial state ──────────────────────────────────────

  it('getLastUsedName() defaults to "rule-based" before any call', () => {
    const { provider } = makeProvider();
    expect(provider.getLastUsedName()).toBe('rule-based');
  });

  it('getLastUsedName() reflects most recent call', () => {
    const { provider } = makeProvider({ zhTokenizer: 'rule-based' });
    provider.getTokenizer('en');
    expect(provider.getLastUsedName()).toBe('english');
    provider.getTokenizer('zh-TW');
    expect(provider.getLastUsedName()).toBe('rule-based');
  });

  // ── Safety: no RetrievalService / query-analysis imports ──────────────────

  it('does not import or reference PostgresRetrievalService', () => {
    // Static check: the module source must not reference retrieval
    const moduleSource = TokenizerProviderService.toString();
    expect(moduleSource).not.toContain('RetrievalService');
    expect(moduleSource).not.toContain('retrieval');
  });
});
