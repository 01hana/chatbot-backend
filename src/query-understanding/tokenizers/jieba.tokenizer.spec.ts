import { JiebaTokenizer, NodeJiebaModule } from './jieba.tokenizer.js';
import { TokenType } from '../types/token-type.enum.js';
import { QueryToken } from '../types/query-token.type.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Create a JiebaTokenizer with a mock nodejieba module injected.
 * The mock `cut()` returns the input as a single-element array so that
 * single-word tokenize() tests are straightforward.
 */
function makeReadyTokenizer(
  cutImpl: (text: string) => string[] = (t) => [t],
): JiebaTokenizer {
  const tokenizer = new JiebaTokenizer();
  const mockMod: NodeJiebaModule = {
    load: jest.fn(),
    cut: jest.fn().mockImplementation(cutImpl),
  };
  tokenizer._setModuleForTesting(mockMod);
  return tokenizer;
}

// ── classifyWord (pure classification — no jieba dependency) ──────────────────

describe('JiebaTokenizer.classifyWord()', () => {
  let tokenizer: JiebaTokenizer;

  beforeEach(() => {
    tokenizer = new JiebaTokenizer();
  });

  // ── Product ────────────────────────────────────────────────────────────────

  it.each([
    ['螺絲'],
    ['螺栓'],
    ['螺帽'],
    ['華司'],
    ['墊圈'],
    ['機械螺絲'],
    ['不鏽鋼螺絲'],
    ['自攻螺絲'],
    ['鑽尾螺絲'],
    ['木螺絲'],
  ])('"%s" → Product', (word) => {
    expect(tokenizer.classifyWord(word)).toBe(TokenType.Product);
  });

  // ── Material ───────────────────────────────────────────────────────────────

  it.each([['不鏽鋼'], ['碳鋼'], ['鍍鋅'], ['黃銅'], ['鈦合金']])(
    '"%s" → Material',
    (word) => {
      expect(tokenizer.classifyWord(word)).toBe(TokenType.Material);
    },
  );

  // ── Spec ───────────────────────────────────────────────────────────────────

  it.each([['304'], ['316'], ['316L'], ['M3'], ['M4'], ['M5'], ['M10']])(
    '"%s" → Spec',
    (word) => {
      expect(tokenizer.classifyWord(word)).toBe(TokenType.Spec);
    },
  );

  // ── Business (not Noise) ───────────────────────────────────────────────────

  it.each([
    ['上班時間'],
    ['營業時間'],
    ['公司地址'],
    ['型錄'],
    ['報價'],
    ['詢價'],
    ['地址'],
    ['位置'],
  ])('"%s" → Business (not Noise)', (word) => {
    expect(tokenizer.classifyWord(word)).toBe(TokenType.Business);
    expect(tokenizer.classifyWord(word)).not.toBe(TokenType.Noise);
  });

  // ── Contact ────────────────────────────────────────────────────────────────

  it.each([['聯絡'], ['電話'], ['業務'], ['客服']])('"%s" → Contact', (word) => {
    expect(tokenizer.classifyWord(word)).toBe(TokenType.Contact);
  });

  // ── Noise ──────────────────────────────────────────────────────────────────

  it.each([['你們'], ['請問'], ['可以'], ['麻煩'], ['嗎'], ['的']])(
    '"%s" → Noise',
    (word) => {
      expect(tokenizer.classifyWord(word)).toBe(TokenType.Noise);
    },
  );
});

// ── tokenize() with mock jieba ────────────────────────────────────────────────

describe('JiebaTokenizer.tokenize()', () => {
  it('returns token with Product type for "螺絲"', async () => {
    const t = makeReadyTokenizer();
    const tokens = await t.tokenize('螺絲', 'zh-TW');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].tokenType).toBe(TokenType.Product);
  });

  it('returns token with Material type for "不鏽鋼"', async () => {
    const t = makeReadyTokenizer();
    const tokens = await t.tokenize('不鏽鋼', 'zh-TW');
    expect(tokens[0].tokenType).toBe(TokenType.Material);
  });

  it('returns token with Spec type for "304"', async () => {
    const t = makeReadyTokenizer();
    const tokens = await t.tokenize('304', 'zh-TW');
    expect(tokens[0].tokenType).toBe(TokenType.Spec);
  });

  it('returns Noise token for "請問"', async () => {
    const t = makeReadyTokenizer();
    const tokens = await t.tokenize('請問', 'zh-TW');
    expect(tokens[0].tokenType).toBe(TokenType.Noise);
  });

  it('returns Business token for "上班時間" — not Noise', async () => {
    const t = makeReadyTokenizer();
    const tokens = await t.tokenize('上班時間', 'zh-TW');
    expect(tokens[0].tokenType).toBe(TokenType.Business);
    expect(tokens[0].tokenType).not.toBe(TokenType.Noise);
  });

  it('returns Business token for "公司地址" — not Noise', async () => {
    const t = makeReadyTokenizer();
    const tokens = await t.tokenize('公司地址', 'zh-TW');
    expect(tokens[0].tokenType).toBe(TokenType.Business);
    expect(tokens[0].tokenType).not.toBe(TokenType.Noise);
  });

  it('handles multi-segment cut result', async () => {
    const t = makeReadyTokenizer((text) =>
      text === '請問有螺絲嗎' ? ['請問', '有', '螺絲', '嗎'] : [text],
    );
    const tokens = await t.tokenize('請問有螺絲嗎', 'zh-TW');
    const types = tokens.map((tok: QueryToken) => tok.tokenType);
    expect(types).toContain(TokenType.Product);
    expect(types).toContain(TokenType.Noise);
  });

  it('filters empty segments from cut result', async () => {
    const t = makeReadyTokenizer((_text) => ['螺絲', '', '  ', '304']);
    const tokens = await t.tokenize('anything', 'zh-TW');
    expect(tokens.every((tok: QueryToken) => tok.text.trim().length > 0)).toBe(true);
  });

  // ── source field ───────────────────────────────────────────────────────────

  it('source="jieba" for a word not in the domain dictionary', async () => {
    const t = makeReadyTokenizer();
    const tokens = await t.tokenize('SomeUnknownWord', 'zh-TW');
    expect(tokens[0].source).toBe('jieba');
  });

  it('source="dictionary" for a word loaded from domain dictionary', async () => {
    // Manually add a word to the dict (simulates a loaded dictionary)
    const t = makeReadyTokenizer();
    // Access _dictWords via cast to test dictionary source attribution
    (t as unknown as { _dictWords: Set<string> })._dictWords.add('螺絲');
    const tokens = await t.tokenize('螺絲', 'zh-TW');
    expect(tokens[0].source).toBe('dictionary');
  });

  it('all tokens have a defined weight > 0', async () => {
    const t = makeReadyTokenizer((_text) => ['螺絲', '304', '不鏽鋼', '聯絡']);
    const tokens = await t.tokenize('anything', 'zh-TW');
    for (const tok of tokens) {
      expect(tok.weight).toBeGreaterThan(0);
    }
  });

  it('normalizedText equals text for CJK tokens', async () => {
    const t = makeReadyTokenizer();
    const tokens = await t.tokenize('螺栓', 'zh-TW');
    expect(tokens[0].normalizedText).toBe(tokens[0].text);
  });
});

// ── Init failure scenarios ────────────────────────────────────────────────────

describe('JiebaTokenizer init failure', () => {
  it('isReady()=false when onModuleInit() called without nodejieba', async () => {
    const tokenizer = new JiebaTokenizer();
    // nodejieba is not installed in this environment, so initJieba() will fail
    await tokenizer.onModuleInit();
    expect(tokenizer.isReady()).toBe(false);
  });

  it('tokenize() returns [] when not ready — does not throw', async () => {
    const tokenizer = new JiebaTokenizer();
    await tokenizer.onModuleInit();
    await expect(tokenizer.tokenize('螺絲', 'zh-TW')).resolves.toEqual([]);
  });

  it('onModuleInit() does not throw even when nodejieba is absent', async () => {
    const tokenizer = new JiebaTokenizer();
    await expect(tokenizer.onModuleInit()).resolves.not.toThrow();
  });
});

// ── Domain dictionary load failure ────────────────────────────────────────────

describe('JiebaTokenizer domain dictionary load failure', () => {
  it('onModuleInit() does not throw when dict file does not exist', async () => {
    const tokenizer = new JiebaTokenizer();
    tokenizer._overrideDictPath = '/nonexistent/path/jieba-domain.txt';
    await expect(tokenizer.onModuleInit()).resolves.not.toThrow();
  });

  it('isReady() is still false after missing dict + no nodejieba', async () => {
    const tokenizer = new JiebaTokenizer();
    tokenizer._overrideDictPath = '/nonexistent/path/jieba-domain.txt';
    await tokenizer.onModuleInit();
    // nodejieba also unavailable → still false
    expect(tokenizer.isReady()).toBe(false);
  });

  it('tokenize() returns [] when dict missing and not ready', async () => {
    const tokenizer = new JiebaTokenizer();
    tokenizer._overrideDictPath = '/nonexistent/path/jieba-domain.txt';
    await tokenizer.onModuleInit();
    await expect(tokenizer.tokenize('螺絲', 'zh-TW')).resolves.toEqual([]);
  });
});
