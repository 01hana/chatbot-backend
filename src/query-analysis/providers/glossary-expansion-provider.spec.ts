import { GlossaryExpansionProvider } from './glossary-expansion-provider';

function makeIntentServiceMock(glossary: Array<{ term: string; synonyms: string[]; id: number; intentLabel: string | null; createdAt: Date }>) {
  return {
    getCachedGlossary: jest.fn().mockReturnValue(glossary),
  };
}

const baseGlossaryEntry = { id: 1, intentLabel: null, createdAt: new Date() };

describe('GlossaryExpansionProvider', () => {
  describe('expand()', () => {
    it('returns original terms unchanged when no glossary entry matches', async () => {
      const intentService = makeIntentServiceMock([
        { ...baseGlossaryEntry, term: '螺帽', synonyms: ['nut', '堅果'] },
      ]);
      const provider = new GlossaryExpansionProvider(intentService as never);

      const result = await provider.expand(['螺絲'], 'zh-TW');
      expect(result).toContain('螺絲');
      expect(result).not.toContain('nut');
    });

    it('appends synonyms when a term exactly matches a glossary entry', async () => {
      const intentService = makeIntentServiceMock([
        { ...baseGlossaryEntry, term: '螺絲', synonyms: ['螺釘', 'screw'] },
      ]);
      const provider = new GlossaryExpansionProvider(intentService as never);

      const result = await provider.expand(['螺絲'], 'zh-TW');
      expect(result).toContain('螺絲');
      expect(result).toContain('螺釘');
      expect(result).toContain('screw');
    });

    it('appends synonyms when a term partially contains a glossary entry term', async () => {
      const intentService = makeIntentServiceMock([
        { ...baseGlossaryEntry, term: '螺絲', synonyms: ['螺釘', 'screw'] },
      ]);
      const provider = new GlossaryExpansionProvider(intentService as never);

      // "不鏽鋼螺絲" contains "螺絲"
      const result = await provider.expand(['不鏽鋼螺絲'], 'zh-TW');
      expect(result).toContain('螺釘');
      expect(result).toContain('screw');
    });

    it('deduplicates the output', async () => {
      const intentService = makeIntentServiceMock([
        { ...baseGlossaryEntry, term: '螺絲', synonyms: ['螺釘', 'screw'] },
      ]);
      const provider = new GlossaryExpansionProvider(intentService as never);

      const result = await provider.expand(['螺絲', '螺絲'], 'zh-TW');
      const screwCount = result.filter(t => t === '螺絲').length;
      expect(screwCount).toBe(1);
    });

    it('is case-insensitive for English terms', async () => {
      const intentService = makeIntentServiceMock([
        { ...baseGlossaryEntry, term: 'Screw', synonyms: ['Bolt', '螺絲'] },
      ]);
      const provider = new GlossaryExpansionProvider(intentService as never);

      const result = await provider.expand(['screw'], 'en');
      expect(result).toContain('bolt');
      expect(result).toContain('螺絲');
    });

    it('handles multiple glossary matches across different terms', async () => {
      const intentService = makeIntentServiceMock([
        { ...baseGlossaryEntry, term: '螺絲', synonyms: ['螺釘', 'screw'] },
        { ...baseGlossaryEntry, id: 2, term: '螺帽', synonyms: ['nut', '帽'] },
      ]);
      const provider = new GlossaryExpansionProvider(intentService as never);

      const result = await provider.expand(['螺絲', '螺帽'], 'zh-TW');
      expect(result).toContain('螺釘');
      expect(result).toContain('screw');
      expect(result).toContain('nut');
      expect(result).toContain('帽');
    });

    it('returns empty array for empty input', async () => {
      const intentService = makeIntentServiceMock([
        { ...baseGlossaryEntry, term: '螺絲', synonyms: ['螺釘'] },
      ]);
      const provider = new GlossaryExpansionProvider(intentService as never);

      const result = await provider.expand([], 'zh-TW');
      expect(result).toEqual([]);
    });

    it('handles empty glossary gracefully', async () => {
      const intentService = makeIntentServiceMock([]);
      const provider = new GlossaryExpansionProvider(intentService as never);

      const result = await provider.expand(['螺絲'], 'zh-TW');
      expect(result).toEqual(['螺絲']);
    });
  });
});
