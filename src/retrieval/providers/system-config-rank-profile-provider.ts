import { Injectable } from '@nestjs/common';
import { SystemConfigService } from '../../system-config/system-config.service';
import { RETRIEVAL_SCORING } from '../constants/retrieval-scoring.constants';
import type { RankingProfile } from '../types/ranking-profile.type';

/**
 * SystemConfigRankProfileProvider — resolves a {@link RankingProfile} by
 * reading overrides from `SystemConfig` and falling back to the
 * {@link RETRIEVAL_SCORING} constants for any key that is absent.
 *
 * Config key convention:  ranking.{profileKey}.{field}
 *
 * Example keys for profileKey="faq":
 *   ranking.faq.trgm_title_boost
 *   ranking.faq.trgm_alias_bonus
 *   ranking.faq.trgm_tag_bonus
 *   ranking.faq.trgm_min_threshold
 *   ranking.faq.ilike_title_score
 *   ranking.faq.ilike_alias_score
 *   ranking.faq.ilike_tag_score
 *   ranking.faq.ilike_content_score
 *
 * When none of these keys exist in SystemConfig the default profile is
 * identical to the RETRIEVAL_SCORING constants.
 */
@Injectable()
export class SystemConfigRankProfileProvider {
  constructor(private readonly systemConfig: SystemConfigService) {}

  /**
   * Get the ranking profile for the given key.
   *
   * @param profileKey - Identifier for the profile (e.g. "faq", "rag", "default").
   * @returns A fully-populated {@link RankingProfile} with fallback values applied.
   */
  getProfile(profileKey: string): RankingProfile {
    const prefix = `ranking.${profileKey}`;
    return {
      trgmTitleBoost: this.systemConfig.getNumberOrDefault(
        `${prefix}.trgm_title_boost`,
        RETRIEVAL_SCORING.TRGM_TITLE_BOOST,
      ),
      trgmAliasBonus: this.systemConfig.getNumberOrDefault(
        `${prefix}.trgm_alias_bonus`,
        RETRIEVAL_SCORING.TRGM_ALIAS_BONUS,
      ),
      trgmTagBonus: this.systemConfig.getNumberOrDefault(
        `${prefix}.trgm_tag_bonus`,
        RETRIEVAL_SCORING.TRGM_TAG_BONUS,
      ),
      trgmMinThreshold: this.systemConfig.getNumberOrDefault(
        `${prefix}.trgm_min_threshold`,
        RETRIEVAL_SCORING.TRGM_MIN_THRESHOLD,
      ),
      ilikeTitleScore: this.systemConfig.getNumberOrDefault(
        `${prefix}.ilike_title_score`,
        RETRIEVAL_SCORING.ILIKE_TITLE_SCORE,
      ),
      ilikeAliasScore: this.systemConfig.getNumberOrDefault(
        `${prefix}.ilike_alias_score`,
        RETRIEVAL_SCORING.ILIKE_ALIAS_SCORE,
      ),
      ilikeTagScore: this.systemConfig.getNumberOrDefault(
        `${prefix}.ilike_tag_score`,
        RETRIEVAL_SCORING.ILIKE_TAG_SCORE,
      ),
      ilikeContentScore: this.systemConfig.getNumberOrDefault(
        `${prefix}.ilike_content_score`,
        RETRIEVAL_SCORING.ILIKE_CONTENT_SCORE,
      ),
    };
  }
}
