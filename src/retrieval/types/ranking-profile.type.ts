/**
 * RankingProfile — a named set of retrieval scoring weights used to tune
 * the ranking behaviour for different retrieval scenarios (e.g. faq vs. rag).
 *
 * Values are resolved by SystemConfigRankProfileProvider from SystemConfig keys
 * of the form:  ranking.{profileKey}.{field}
 *
 * Fallback values come from RETRIEVAL_SCORING constants.
 */
export interface RankingProfile {
  /** Multiplier applied to trgm title similarity score. */
  trgmTitleBoost: number;
  /** Bonus added when an alias matches via ILIKE during trgm scoring. */
  trgmAliasBonus: number;
  /** Bonus added when a tag matches via ILIKE during trgm scoring. */
  trgmTagBonus: number;
  /** Minimum trgm similarity threshold to include a result. */
  trgmMinThreshold: number;
  /** Flat score for content-field ILIKE match. */
  ilikeTitleScore: number;
  /** Flat score for alias-field ILIKE match. */
  ilikeAliasScore: number;
  /** Flat score for tag-field ILIKE match. */
  ilikeTagScore: number;
  /** Flat score for content-field ILIKE match. */
  ilikeContentScore: number;
}
