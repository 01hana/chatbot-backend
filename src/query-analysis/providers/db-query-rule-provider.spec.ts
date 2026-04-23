import { DbQueryRuleProvider } from './db-query-rule-provider';

/** Minimal PrismaService mock — only queryRule.findMany is needed. */
function makePrismaMock(rows: Array<{
  id: number;
  type: string;
  language: string;
  value: string;
  isActive: boolean;
  priority: number;
  createdAt: Date;
}>) {
  return {
    queryRule: {
      findMany: jest.fn().mockResolvedValue(rows),
    },
  };
}

const baseRow = { id: 1, isActive: true, createdAt: new Date() };

describe('DbQueryRuleProvider', () => {
  // ── getStopWords ──────────────────────────────────────────────────────────

  describe('getStopWords()', () => {
    it('returns zh-TW stop words from DB', async () => {
      const prisma = makePrismaMock([
        { ...baseRow, type: 'stop_word', language: 'zh-TW', value: '請問', priority: 10 },
        { ...baseRow, id: 2, type: 'stop_word', language: 'zh-TW', value: '你好', priority: 5 },
      ]);
      const provider = new DbQueryRuleProvider(prisma as never);

      const result = await provider.getStopWords('zh-TW');

      expect(result.has('請問')).toBe(true);
      expect(result.has('你好')).toBe(true);
    });

    it('returns en stop words from DB', async () => {
      const prisma = makePrismaMock([
        { ...baseRow, type: 'stop_word', language: 'en', value: 'the', priority: 0 },
        { ...baseRow, id: 2, type: 'stop_word', language: 'en', value: 'a', priority: 0 },
      ]);
      const provider = new DbQueryRuleProvider(prisma as never);

      const result = await provider.getStopWords('en');

      expect(result.has('the')).toBe(true);
      expect(result.has('a')).toBe(true);
    });

    it('falls back to hardcoded stop words when DB returns empty', async () => {
      const prisma = makePrismaMock([]);
      const provider = new DbQueryRuleProvider(prisma as never);

      const zhResult = await provider.getStopWords('zh-TW');
      expect(zhResult.has('請問')).toBe(true);
      expect(zhResult.size).toBeGreaterThanOrEqual(15);

      const enResult = await provider.getStopWords('en');
      expect(enResult.has('the')).toBe(true);
      expect(enResult.size).toBeGreaterThan(20);
    });

    it('returns empty Set for unknown language when DB is empty', async () => {
      const prisma = makePrismaMock([]);
      const provider = new DbQueryRuleProvider(prisma as never);

      const result = await provider.getStopWords('fr');
      expect(result.size).toBe(0);
    });
  });

  // ── getNoiseWords ─────────────────────────────────────────────────────────

  describe('getNoiseWords()', () => {
    it('returns noise words from DB', async () => {
      const prisma = makePrismaMock([
        { ...baseRow, type: 'noise_word', language: 'zh-TW', value: '一些', priority: 0 },
      ]);
      const provider = new DbQueryRuleProvider(prisma as never);

      const result = await provider.getNoiseWords('zh-TW');
      expect(result.has('一些')).toBe(true);
    });

    it('falls back to hardcoded noise words when DB returns empty', async () => {
      const prisma = makePrismaMock([]);
      const provider = new DbQueryRuleProvider(prisma as never);

      const result = await provider.getNoiseWords('zh-TW');
      expect(result.has('一些')).toBe(true);
    });
  });

  // ── getQuestionShellPatterns ──────────────────────────────────────────────

  describe('getQuestionShellPatterns()', () => {
    it('returns compiled RegExp array from DB', async () => {
      const prisma = makePrismaMock([
        {
          ...baseRow,
          type: 'question_shell_zh',
          language: 'zh-TW',
          value: '^(請問)',
          priority: 20,
        },
      ]);
      const provider = new DbQueryRuleProvider(prisma as never);

      const patterns = await provider.getQuestionShellPatterns('zh-TW');
      expect(patterns).toHaveLength(1);
      expect(patterns[0]).toBeInstanceOf(RegExp);
      expect(patterns[0].test('請問有哪些')).toBe(true);
    });

    it('falls back to hardcoded patterns when DB returns empty', async () => {
      const prisma = makePrismaMock([]);
      const provider = new DbQueryRuleProvider(prisma as never);

      const zhPatterns = await provider.getQuestionShellPatterns('zh-TW');
      expect(zhPatterns.length).toBeGreaterThanOrEqual(3);
      // Verify patterns are functional
      expect(zhPatterns.some(p => p.test('請問一下'))).toBe(true);

      const enPatterns = await provider.getQuestionShellPatterns('en');
      expect(enPatterns.length).toBeGreaterThanOrEqual(2);
      expect(enPatterns.some(p => p.test('how can i '))).toBe(true);
    });

    it('skips invalid regex patterns and logs warning', async () => {
      const prisma = makePrismaMock([
        { ...baseRow, type: 'question_shell_zh', language: 'zh-TW', value: '[invalid(', priority: 0 },
        { ...baseRow, id: 2, type: 'question_shell_zh', language: 'zh-TW', value: '^(valid)', priority: 0 },
      ]);
      const provider = new DbQueryRuleProvider(prisma as never);

      const patterns = await provider.getQuestionShellPatterns('zh-TW');
      // Only the valid pattern is included
      expect(patterns).toHaveLength(1);
    });
  });

  // ── Caching behaviour ─────────────────────────────────────────────────────

  describe('caching', () => {
    it('calls DB only once and caches subsequent requests', async () => {
      const prisma = makePrismaMock([
        { ...baseRow, type: 'stop_word', language: 'zh-TW', value: '請問', priority: 10 },
      ]);
      const provider = new DbQueryRuleProvider(prisma as never);

      await provider.getStopWords('zh-TW');
      await provider.getStopWords('en');
      await provider.getNoiseWords('zh-TW');

      expect(prisma.queryRule.findMany).toHaveBeenCalledTimes(1);
    });

    it('re-fetches DB after invalidateCache()', async () => {
      const prisma = makePrismaMock([
        { ...baseRow, type: 'stop_word', language: 'zh-TW', value: '請問', priority: 10 },
      ]);
      const provider = new DbQueryRuleProvider(prisma as never);

      await provider.getStopWords('zh-TW');
      provider.invalidateCache();
      await provider.getStopWords('zh-TW');

      expect(prisma.queryRule.findMany).toHaveBeenCalledTimes(2);
    });

    it('does not load inactive rules', async () => {
      const prisma = makePrismaMock([
        { ...baseRow, type: 'stop_word', language: 'zh-TW', value: '你好', priority: 5, isActive: false },
      ]);
      // The mock always returns what we give it regardless of `where`,
      // so we verify the where clause contains isActive: true.
      const provider = new DbQueryRuleProvider(prisma as never);
      await provider.getStopWords('zh-TW');

      expect(prisma.queryRule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });
  });
});
