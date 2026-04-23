import { RuleBasedTokenizer } from './rule-based-tokenizer';

describe('RuleBasedTokenizer', () => {
  const tokenizer = new RuleBasedTokenizer();

  // ── English ───────────────────────────────────────────────────────────────

  describe('tokenize() — English', () => {
    it('splits on whitespace', () => {
      expect(tokenizer.tokenize('M3 stainless steel bolts', 'en')).toEqual([
        'M3', 'stainless', 'steel', 'bolts',
      ]);
    });

    it('strips punctuation boundaries', () => {
      // tokenizer splits on whitespace + punctuation → individual words
      const tokens = tokenizer.tokenize('hex bolts, M6 screws', 'en');
      expect(tokens).toContain('hex');
      expect(tokens).toContain('bolts');
      expect(tokens).toContain('M6');
      expect(tokens).toContain('screws');
    });

    it('preserves hyphenated tokens like ISO-4762', () => {
      const tokens = tokenizer.tokenize('ISO-4762 metric screw', 'en');
      expect(tokens).toContain('ISO-4762');
    });

    it('returns empty array for empty input', () => {
      expect(tokenizer.tokenize('', 'en')).toEqual([]);
    });

    it('returns empty array for whitespace-only input', () => {
      expect(tokenizer.tokenize('   ', 'en')).toEqual([]);
    });
  });

  // ── Chinese ───────────────────────────────────────────────────────────────

  describe('tokenize() — zh-TW', () => {
    it('emits individual CJK characters', () => {
      const tokens = tokenizer.tokenize('螺絲類別', 'zh-TW');
      expect(tokens).toContain('螺');
      expect(tokens).toContain('絲');
      expect(tokens).toContain('類');
      expect(tokens).toContain('別');
    });

    it('keeps ASCII alphanumeric runs whole (e.g. M3)', () => {
      const tokens = tokenizer.tokenize('M3螺絲規格', 'zh-TW');
      expect(tokens).toContain('M3');
      expect(tokens).toContain('螺');
    });

    it('handles mixed zh/en correctly', () => {
      const tokens = tokenizer.tokenize('M3 不鏽鋼螺栓', 'zh-TW');
      expect(tokens).toContain('M3');
      expect(tokens).toContain('不');
      expect(tokens).toContain('鏽');
    });

    it('returns empty array for empty input', () => {
      expect(tokenizer.tokenize('', 'zh-TW')).toEqual([]);
    });
  });
});
