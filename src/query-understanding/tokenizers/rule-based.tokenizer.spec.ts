import { RuleBasedTokenizerAdapter } from './rule-based.tokenizer.js';
import { TokenType } from '../types/token-type.enum.js';
import { QueryToken } from '../types/query-token.type.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const adapter = new RuleBasedTokenizerAdapter();

async function tokenize(text: string): Promise<QueryToken[]> {
  return adapter.tokenize(text, 'zh-TW');
}

function hasType(tokens: QueryToken[], type: TokenType): boolean {
  return tokens.some((t) => t.tokenType === type);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RuleBasedTokenizerAdapter', () => {
  // ── Basic contract ────────────────────────────────────────────────────────

  it('does not throw for a normal query', async () => {
    await expect(tokenize('你們有哪些螺絲')).resolves.toBeDefined();
  });

  it('does not throw for an empty string', async () => {
    await expect(tokenize('')).resolves.toBeDefined();
  });

  it('returns an array (may be empty) for any input', async () => {
    const result = await tokenize('random input 123');
    expect(Array.isArray(result)).toBe(true);
  });

  // ── source field ──────────────────────────────────────────────────────────

  it('all tokens have source="rule-based"', async () => {
    const tokens = await tokenize('你們有哪些螺絲類別');
    expect(tokens.length).toBeGreaterThan(0);
    for (const t of tokens) {
      expect(t.source).toBe('rule-based');
    }
  });

  // ── Product tokens ────────────────────────────────────────────────────────

  it('"螺絲" alone produces a Product token via bigram sliding window', async () => {
    // 002 tokenizer emits ['螺', '絲']; adapter builds bigram '螺絲' → PRODUCT_RE match
    const tokens = await tokenize('螺絲');
    expect(tokens.length).toBeGreaterThan(0);
    expect(hasType(tokens, TokenType.Product)).toBe(true);
  });

  it('"你們有哪些螺絲類別" produces a Product token via bigram', async () => {
    const tokens = await tokenize('你們有哪些螺絲類別');
    expect(hasType(tokens, TokenType.Product)).toBe(true);
  });

  it('"螺栓" query produces Product token', async () => {
    const tokens = await tokenize('你們賣螺栓嗎');
    expect(hasType(tokens, TokenType.Product)).toBe(true);
  });

  // ── Noise tokens ──────────────────────────────────────────────────────────

  it('question-shell word "請問" produces Noise token', async () => {
    const tokens = await tokenize('請問');
    expect(hasType(tokens, TokenType.Noise)).toBe(true);
  });

  it('"你們" produces Noise token', async () => {
    const tokens = await tokenize('你們');
    expect(hasType(tokens, TokenType.Noise)).toBe(true);
  });

  // ── Spec tokens ───────────────────────────────────────────────────────────

  it.each([['304'], ['316'], ['M3'], ['M4']])('spec "%s" produces Spec token', async (spec) => {
    const tokens = await tokenize(spec);
    expect(hasType(tokens, TokenType.Spec)).toBe(true);
  });

  // ── Business tokens ───────────────────────────────────────────────────────

  it('"報價" produces Business token', async () => {
    const tokens = await tokenize('報價');
    expect(hasType(tokens, TokenType.Business)).toBe(true);
  });

  // ── Token structure ───────────────────────────────────────────────────────

  it('all tokens have weight > 0', async () => {
    const tokens = await tokenize('螺絲報價304');
    for (const t of tokens) {
      expect(t.weight).toBeGreaterThan(0);
    }
  });

  it('all tokens have non-empty text', async () => {
    const tokens = await tokenize('螺絲你們報價304');
    for (const t of tokens) {
      expect(t.text.trim().length).toBeGreaterThan(0);
    }
  });
});
