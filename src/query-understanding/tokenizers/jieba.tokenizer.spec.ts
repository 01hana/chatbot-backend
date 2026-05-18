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

// ── Dictionary recovery (_applyDictionaryRecovery) ───────────────────────────
// Simulates the case where jieba returns over-fragmented single-char tokens
// (as happens without the userDict loaded) and the recovery pass re-merges them.

describe('JiebaTokenizer dictionary recovery (T064 regression)', () => {
  /**
   * Build a tokenizer whose _dictWords are pre-populated with the given words
   * and whose mock cut() simulates over-fragmentation (single chars + spec code splits).
   */
  function makeRecoveryTokenizer(
    dictWords: string[],
    cutImpl: (text: string) => string[],
  ): JiebaTokenizer {
    const tokenizer = new JiebaTokenizer();
    const mockMod: NodeJiebaModule = {
      load: jest.fn(),
      cut: jest.fn().mockImplementation(cutImpl),
    };
    tokenizer._setModuleForTesting(mockMod);
    for (const w of dictWords) {
      (tokenizer as unknown as { _dictWords: Set<string> })._dictWords.add(w);
    }
    return tokenizer;
  }

  const DICT_WORDS = [
    '不鏽鋼螺絲',
    '不鏽鋼',
    '螺絲',
    '304',
    '316',
    '差異',
    '比較',
    '差在',
    '材質',
  ];

  // jieba without userDict commonly splits domain terms into single chars and digits
  const FRAGMENTED_CUT = (_text: string): string[] =>
    ['我', '想', '知', '道', '不', '鏽', '鋼', '螺', '絲', ' ', '3', '0', '4', '跟', '3', '1', '6', '差', '在', '哪'];

  it('recovered tokens contain 不鏽鋼 or 不鏽鋼螺絲 (domain recovery)', async () => {
    const t = makeRecoveryTokenizer(DICT_WORDS, FRAGMENTED_CUT);
    const tokens = await t.tokenize('我想知道不鏽鋼螺絲 304 跟 316 差在哪', 'zh-TW');
    const texts = tokens.map(tok => tok.text);
    const hasMaterial = texts.includes('不鏽鋼') || texts.includes('不鏽鋼螺絲');
    expect(hasMaterial).toBe(true);
  });

  it('recovered tokens contain 螺絲 or 不鏽鋼螺絲', async () => {
    const t = makeRecoveryTokenizer(DICT_WORDS, FRAGMENTED_CUT);
    const tokens = await t.tokenize('我想知道不鏽鋼螺絲 304 跟 316 差在哪', 'zh-TW');
    const texts = tokens.map(tok => tok.text);
    const hasProduct = texts.includes('螺絲') || texts.includes('不鏽鋼螺絲');
    expect(hasProduct).toBe(true);
  });

  it('recovered tokens contain 304 as a single token (not 3/0/4)', async () => {
    const t = makeRecoveryTokenizer(DICT_WORDS, FRAGMENTED_CUT);
    const tokens = await t.tokenize('我想知道不鏽鋼螺絲 304 跟 316 差在哪', 'zh-TW');
    const texts = tokens.map(tok => tok.text);
    expect(texts).toContain('304');
    expect(texts).not.toContain('3');
  });

  it('recovered tokens contain 316 as a single token (not 3/1/6)', async () => {
    const t = makeRecoveryTokenizer(DICT_WORDS, FRAGMENTED_CUT);
    const tokens = await t.tokenize('我想知道不鏽鋼螺絲 304 跟 316 差在哪', 'zh-TW');
    const texts = tokens.map(tok => tok.text);
    expect(texts).toContain('316');
  });

  it('tokens are not all single characters', async () => {
    const t = makeRecoveryTokenizer(DICT_WORDS, FRAGMENTED_CUT);
    const tokens = await t.tokenize('我想知道不鏽鋼螺絲 304 跟 316 差在哪', 'zh-TW');
    const hasMultiChar = tokens.some(tok => tok.text.length > 1);
    expect(hasMultiChar).toBe(true);
  });

  it('304 token has tokenType=Spec', async () => {
    const t = makeRecoveryTokenizer(DICT_WORDS, FRAGMENTED_CUT);
    const tokens = await t.tokenize('304', 'zh-TW');
    // Mock cut returns each digit as single char
    const mockMod = (t as unknown as { _jiebaModule: NodeJiebaModule })._jiebaModule;
    (mockMod.cut as jest.Mock).mockReturnValue(['3', '0', '4']);
    const tokens2 = await t.tokenize('304', 'zh-TW');
    const tok304 = tokens2.find(tok => tok.text === '304');
    expect(tok304).toBeDefined();
    expect(tok304!.tokenType).toBe(TokenType.Spec);
  });

  it('不鏽鋼 recovered token has tokenType=Material', async () => {
    const t = makeRecoveryTokenizer(DICT_WORDS, (_text) => ['不', '鏽', '鋼']);
    const tokens = await t.tokenize('不鏽鋼', 'zh-TW');
    const tokMat = tokens.find(tok => tok.text === '不鏽鋼');
    expect(tokMat).toBeDefined();
    expect(tokMat!.tokenType).toBe(TokenType.Material);
  });

  it('螺絲 recovered token has tokenType=Product', async () => {
    const t = makeRecoveryTokenizer(DICT_WORDS, (_text) => ['螺', '絲']);
    const tokens = await t.tokenize('螺絲', 'zh-TW');
    const tokProd = tokens.find(tok => tok.text === '螺絲');
    expect(tokProd).toBeDefined();
    expect(tokProd!.tokenType).toBe(TokenType.Product);
  });

  it('source="domain-dictionary" or "dictionary" for recovered domain terms', async () => {
    const t = makeRecoveryTokenizer(['不鏽鋼'], (_text) => ['不', '鏽', '鋼']);
    const tokens = await t.tokenize('不鏽鋼', 'zh-TW');
    const tokMat = tokens.find(tok => tok.text === '不鏽鋼');
    expect(tokMat).toBeDefined();
    // After recovery, the word is in _dictWords → source = 'dictionary'
    expect(tokMat!.source).toBe('dictionary');
  });
});

