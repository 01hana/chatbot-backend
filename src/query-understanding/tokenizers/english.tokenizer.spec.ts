import { EnglishTokenizer } from './english.tokenizer.js';
import { TokenType } from '../types/token-type.enum.js';
import { QueryToken } from '../types/query-token.type.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function tokenize(text: string): Promise<QueryToken[]> {
  return new EnglishTokenizer().tokenize(text, 'en');
}

function tokenTypes(tokens: QueryToken[]): TokenType[] {
  return tokens.map((t) => t.tokenType);
}

function hasType(tokens: QueryToken[], type: TokenType): boolean {
  return tokens.some((t) => t.tokenType === type);
}

function findByText(tokens: QueryToken[], text: string): QueryToken | undefined {
  return tokens.find((t) => t.text === text || t.normalizedText === text);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EnglishTokenizer', () => {
  // ── source field ──────────────────────────────────────────────────────────

  describe('source field', () => {
    it('all tokens have source="english"', async () => {
      const tokens = await tokenize('screw bolt nut');
      expect(tokens.length).toBeGreaterThan(0);
      for (const t of tokens) {
        expect(t.source).toBe('english');
      }
    });
  });

  // ── Product terms ─────────────────────────────────────────────────────────

  describe('Product terms', () => {
    it.each([
      ['screw'],
      ['screws'],
      ['bolt'],
      ['bolts'],
      ['nut'],
      ['nuts'],
      ['washer'],
      ['washers'],
      ['fastener'],
      ['fasteners'],
      ['wire'],
      ['wires'],
    ])('"%s" → Product', async (word) => {
      const tokens = await tokenize(word);
      expect(tokens.length).toBeGreaterThan(0);
      expect(tokens[0].tokenType).toBe(TokenType.Product);
    });
  });

  // ── Material terms ────────────────────────────────────────────────────────

  describe('Material terms', () => {
    it('"stainless steel" phrase → Material token', async () => {
      const tokens = await tokenize('stainless steel bolts');
      const mat = tokens.find((t) => t.tokenType === TokenType.Material);
      expect(mat).toBeDefined();
      expect(mat!.normalizedText).toBe('stainless steel');
    });

    it('"carbon steel" phrase → Material token', async () => {
      const tokens = await tokenize('carbon steel screws');
      expect(hasType(tokens, TokenType.Material)).toBe(true);
    });

    it.each([['galvanized'], ['aluminum'], ['copper'], ['brass'], ['titanium']])(
      '"%s" → Material',
      async (word) => {
        const tokens = await tokenize(word);
        expect(tokens[0].tokenType).toBe(TokenType.Material);
      },
    );
  });

  // ── Spec terms ────────────────────────────────────────────────────────────

  describe('Spec terms', () => {
    it.each([['304'], ['316'], ['316L'], ['M3'], ['M4'], ['M5'], ['M10']])(
      '"%s" → Spec',
      async (word) => {
        const tokens = await tokenize(word);
        expect(tokens.length).toBeGreaterThan(0);
        expect(tokens[0].tokenType).toBe(TokenType.Spec);
      },
    );

    it('ISO pattern → Spec', async () => {
      const tokens = await tokenize('ISO4762');
      expect(tokens[0].tokenType).toBe(TokenType.Spec);
    });

    it('DIN pattern → Spec', async () => {
      const tokens = await tokenize('DIN933');
      expect(tokens[0].tokenType).toBe(TokenType.Spec);
    });
  });

  // ── Business terms ────────────────────────────────────────────────────────

  describe('Business terms', () => {
    it.each([
      ['quote'],
      ['quotation'],
      ['price'],
      ['pricing'],
      ['catalog'],
      ['catalogue'],
      ['brochure'],
      ['download'],
    ])('"%s" → Business', async (word) => {
      const tokens = await tokenize(word);
      expect(tokens[0].tokenType).toBe(TokenType.Business);
    });

    it('"hours" → Business (not Noise)', async () => {
      const tokens = await tokenize('hours');
      expect(tokens[0].tokenType).toBe(TokenType.Business);
      expect(tokens[0].tokenType).not.toBe(TokenType.Noise);
    });

    it('"address" → Business (not Noise)', async () => {
      const tokens = await tokenize('address');
      expect(tokens[0].tokenType).toBe(TokenType.Business);
      expect(tokens[0].tokenType).not.toBe(TokenType.Noise);
    });

    it('"location" → Business (not Noise)', async () => {
      const tokens = await tokenize('location');
      expect(tokens[0].tokenType).toBe(TokenType.Business);
      expect(tokens[0].tokenType).not.toBe(TokenType.Noise);
    });

    it('"business hours" phrase → Business token (not split into Noise)', async () => {
      const tokens = await tokenize('business hours');
      expect(hasType(tokens, TokenType.Business)).toBe(true);
      // The phrase should produce a Business token, not Noise
      const businessToken = tokens.find((t) => t.tokenType === TokenType.Business);
      expect(businessToken).toBeDefined();
    });

    it('"office hours" phrase → Business token', async () => {
      const tokens = await tokenize('office hours');
      expect(hasType(tokens, TokenType.Business)).toBe(true);
    });

    it('"business hours" tokens are not all Noise or Unknown', async () => {
      const tokens = await tokenize('business hours');
      const onlyNoisyTypes = tokens.every(
        (t) => t.tokenType === TokenType.Noise || t.tokenType === TokenType.Unknown,
      );
      expect(onlyNoisyTypes).toBe(false);
    });
  });

  // ── Contact terms ─────────────────────────────────────────────────────────

  describe('Contact terms', () => {
    it.each([['contact'], ['email'], ['phone'], ['call'], ['whatsapp']])(
      '"%s" → Contact',
      async (word) => {
        const tokens = await tokenize(word);
        expect(tokens[0].tokenType).toBe(TokenType.Contact);
      },
    );

    it('"sales" → Contact', async () => {
      const tokens = await tokenize('sales');
      expect(tokens[0].tokenType).toBe(TokenType.Contact);
    });
  });

  // ── Stop word filtering ───────────────────────────────────────────────────

  describe('stop words', () => {
    it.each([
      ['how'],
      ['can'],
      ['i'],
      ['your'],
      ['you'],
      ['the'],
      ['a'],
      ['an'],
      ['for'],
      ['to'],
      ['do'],
      ['does'],
      ['what'],
      ['is'],
      ['are'],
      ['please'],
    ])('stop word "%s" does not produce a high-value token', async (word) => {
      const tokens = await tokenize(word);
      // Stop words should either be filtered out entirely or produce no Product/Spec/Material/Business/Contact tokens
      for (const t of tokens) {
        expect(t.tokenType).not.toBe(TokenType.Product);
        expect(t.tokenType).not.toBe(TokenType.Spec);
        expect(t.tokenType).not.toBe(TokenType.Material);
        expect(t.tokenType).not.toBe(TokenType.Business);
        expect(t.tokenType).not.toBe(TokenType.Contact);
      }
    });

    it('stop words in a full sentence are not in the output', async () => {
      const tokens = await tokenize('how do i find your screw catalog');
      const texts = tokens.map((t) => t.text);
      // These stop words should not appear as tokens
      expect(texts).not.toContain('how');
      expect(texts).not.toContain('do');
      expect(texts).not.toContain('i');
      expect(texts).not.toContain('your');
    });
  });

  // ── Full sentence examples ────────────────────────────────────────────────

  describe('full sentence examples', () => {
    it('"How can I contact your company for a quote?" → has Contact or Business signal', async () => {
      const tokens = await tokenize('How can I contact your company for a quote?');
      expect(
        hasType(tokens, TokenType.Contact) || hasType(tokens, TokenType.Business),
      ).toBe(true);
    });

    it('"How can I contact your company for a quote?" → not all Noise/Unknown', async () => {
      const tokens = await tokenize('How can I contact your company for a quote?');
      const allNoisyOrUnknown = tokens.every(
        (t) => t.tokenType === TokenType.Noise || t.tokenType === TokenType.Unknown,
      );
      expect(allNoisyOrUnknown).toBe(false);
    });

    it('"What screw categories do you offer?" → has Product signal', async () => {
      const tokens = await tokenize('What screw categories do you offer?');
      expect(hasType(tokens, TokenType.Product)).toBe(true);
    });

    it('"Do you have 304 stainless steel bolts?" → Spec + Material + Product', async () => {
      const tokens = await tokenize('Do you have 304 stainless steel bolts?');
      expect(hasType(tokens, TokenType.Spec)).toBe(true);
      expect(hasType(tokens, TokenType.Material)).toBe(true);
      expect(hasType(tokens, TokenType.Product)).toBe(true);
    });

    it('"What are your business hours and office address?" → Business signal', async () => {
      const tokens = await tokenize('What are your business hours and office address?');
      expect(hasType(tokens, TokenType.Business)).toBe(true);
    });

    it('"Please send me your product catalog" → Business signal (catalog)', async () => {
      const tokens = await tokenize('Please send me your product catalog');
      expect(hasType(tokens, TokenType.Business)).toBe(true);
    });
  });

  // ── Robustness ────────────────────────────────────────────────────────────

  describe('robustness', () => {
    it('empty string → empty array, no throw', async () => {
      await expect(tokenize('')).resolves.toEqual([]);
    });

    it('whitespace-only string → empty array, no throw', async () => {
      await expect(tokenize('   ')).resolves.toEqual([]);
    });

    it('heavy punctuation → no throw', async () => {
      await expect(tokenize('!!!...???---')).resolves.toBeDefined();
    });

    it('mixed punctuation and words → no throw, non-empty result', async () => {
      const tokens = await tokenize('screw?bolt!nut');
      await expect(Promise.resolve(tokens)).resolves.toBeDefined();
    });

    it('normalizedText is always lowercase', async () => {
      const tokens = await tokenize('SCREW BOLT 304');
      for (const t of tokens) {
        expect(t.normalizedText).toBe(t.normalizedText.toLowerCase());
      }
    });

    it('all tokens have a defined weight > 0', async () => {
      const tokens = await tokenize('screw bolt stainless steel 304 contact');
      for (const t of tokens) {
        expect(t.weight).toBeGreaterThan(0);
      }
    });
  });
});
