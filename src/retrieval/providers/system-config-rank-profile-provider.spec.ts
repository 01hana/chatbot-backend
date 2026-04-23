import { SystemConfigRankProfileProvider } from './system-config-rank-profile-provider';
import { RETRIEVAL_SCORING } from '../constants/retrieval-scoring.constants';

function makeSystemConfigMock(overrides: Record<string, number> = {}) {
  return {
    getNumberOrDefault: jest.fn((key: string, defaultValue: number) => {
      return key in overrides ? overrides[key] : defaultValue;
    }),
  };
}

describe('SystemConfigRankProfileProvider', () => {
  describe('getProfile()', () => {
    it('returns RETRIEVAL_SCORING defaults when no SystemConfig overrides exist', () => {
      const systemConfig = makeSystemConfigMock();
      const provider = new SystemConfigRankProfileProvider(systemConfig as never);

      const profile = provider.getProfile('faq');

      expect(profile.trgmTitleBoost).toBe(RETRIEVAL_SCORING.TRGM_TITLE_BOOST);
      expect(profile.trgmAliasBonus).toBe(RETRIEVAL_SCORING.TRGM_ALIAS_BONUS);
      expect(profile.trgmTagBonus).toBe(RETRIEVAL_SCORING.TRGM_TAG_BONUS);
      expect(profile.trgmMinThreshold).toBe(RETRIEVAL_SCORING.TRGM_MIN_THRESHOLD);
      expect(profile.ilikeTitleScore).toBe(RETRIEVAL_SCORING.ILIKE_TITLE_SCORE);
      expect(profile.ilikeAliasScore).toBe(RETRIEVAL_SCORING.ILIKE_ALIAS_SCORE);
      expect(profile.ilikeTagScore).toBe(RETRIEVAL_SCORING.ILIKE_TAG_SCORE);
      expect(profile.ilikeContentScore).toBe(RETRIEVAL_SCORING.ILIKE_CONTENT_SCORE);
    });

    it('applies SystemConfig overrides for the matching profile key', () => {
      const systemConfig = makeSystemConfigMock({
        'ranking.faq.trgm_title_boost': 1.5,
        'ranking.faq.ilike_title_score': 0.95,
      });
      const provider = new SystemConfigRankProfileProvider(systemConfig as never);

      const profile = provider.getProfile('faq');

      expect(profile.trgmTitleBoost).toBe(1.5);
      expect(profile.ilikeTitleScore).toBe(0.95);
      // Non-overridden keys still use defaults
      expect(profile.trgmAliasBonus).toBe(RETRIEVAL_SCORING.TRGM_ALIAS_BONUS);
    });

    it('uses different prefix for different profile keys', () => {
      const systemConfig = makeSystemConfigMock({
        'ranking.rag.trgm_title_boost': 1.1,
        'ranking.faq.trgm_title_boost': 1.5,
      });
      const provider = new SystemConfigRankProfileProvider(systemConfig as never);

      const ragProfile = provider.getProfile('rag');
      const faqProfile = provider.getProfile('faq');

      expect(ragProfile.trgmTitleBoost).toBe(1.1);
      expect(faqProfile.trgmTitleBoost).toBe(1.5);
    });

    it('queries SystemConfig with the correct key format', () => {
      const systemConfig = makeSystemConfigMock();
      const provider = new SystemConfigRankProfileProvider(systemConfig as never);

      provider.getProfile('default');

      expect(systemConfig.getNumberOrDefault).toHaveBeenCalledWith(
        'ranking.default.trgm_title_boost',
        expect.any(Number),
      );
      expect(systemConfig.getNumberOrDefault).toHaveBeenCalledWith(
        'ranking.default.ilike_title_score',
        expect.any(Number),
      );
    });

    it('returns a complete profile with all 8 fields populated', () => {
      const systemConfig = makeSystemConfigMock();
      const provider = new SystemConfigRankProfileProvider(systemConfig as never);

      const profile = provider.getProfile('any');

      const keys: Array<keyof typeof profile> = [
        'trgmTitleBoost', 'trgmAliasBonus', 'trgmTagBonus', 'trgmMinThreshold',
        'ilikeTitleScore', 'ilikeAliasScore', 'ilikeTagScore', 'ilikeContentScore',
      ];
      for (const key of keys) {
        expect(typeof profile[key]).toBe('number');
      }
    });
  });
});
