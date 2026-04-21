/**
 * Retrieval scoring constants — single source of truth for all ranking weights.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  Field priority (highest → lowest)                                      │
 * │    title  >  aliases  >  tags  >  content                               │
 * │                                                                          │
 * │  Language priority:                                                      │
 * │    Same-language results returned first.                                  │
 * │    Cross-language fallback triggered only when same-language returns []. │
 * │    Cross-language results flagged with isCrossLanguageFallback=true.     │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Field responsibilities (enforced by convention):
 *  - `language`  — ISO language tag for language-aware retrieval. zh-TW | en.
 *                  Never substitute with tags.
 *  - `aliases`   — FAQ question variants / natural-language phrasings.
 *                  Used for FAQ-friendly ILIKE retrieval.
 *                  Do NOT use tags as a substitute for aliases.
 *  - `tags`      — Product keywords, category labels, spec identifiers.
 *                  Should NOT contain complete natural-language sentences.
 *                  Should NOT be used as a language or aliases replacement.
 *
 * Adjustment guide:
 *  All scoring weights are centralised here. To re-tune ranking behaviour,
 *  change the constants below — no other files need editing.
 */
export const RETRIEVAL_SCORING = {
  // ── ILIKE strategy flat scores (SQL CASE expression) ──────────────────
  /**
   * Score assigned when the entry title contains the query substring.
   * Highest field score — title is the canonical name of the entry.
   */
  ILIKE_TITLE_SCORE: 0.90,

  /**
   * Score assigned when any alias contains the query substring.
   * Aliases hold FAQ question variants; a match means the entry is highly relevant.
   */
  ILIKE_ALIAS_SCORE: 0.85,

  /**
   * Score assigned when any tag contains the query substring.
   * Tags are product-category keywords; weaker signal than alias.
   */
  ILIKE_TAG_SCORE: 0.70,

  /**
   * Score assigned when the entry content body contains the query substring.
   * Weakest field score — broad match in body text.
   */
  ILIKE_CONTENT_SCORE: 0.50,

  // ── pg_trgm strategy (similarity + bonus) ─────────────────────────────
  /**
   * Title similarity multiplier.
   * GREATEST(similarity(title)*TRGM_TITLE_BOOST, similarity(content)) to
   * ensure title matches rank higher than equal-score content matches.
   */
  TRGM_TITLE_BOOST: 1.2,

  /**
   * Bonus added on top of the trgm similarity score when an alias matches
   * the query via ILIKE. Rewards exact-phrase FAQ variant hits.
   */
  TRGM_ALIAS_BONUS: 0.10,

  /**
   * Bonus added on top of the trgm similarity score when a tag matches
   * the query via ILIKE. Smaller than TRGM_ALIAS_BONUS since tags are weaker signals.
   */
  TRGM_TAG_BONUS: 0.05,

  /**
   * Minimum trgm similarity threshold.
   * Entries below this threshold are excluded from trgm results unless they
   * have an alias or tag ILIKE hit (which can still surface relevant entries).
   */
  TRGM_MIN_THRESHOLD: 0.1,

  // ── App-layer reranking bonuses (per matched term) ────────────────────
  /**
   * Bonus per extracted search term found in the entry title.
   * Applied during multi-term reranking after SQL retrieval.
   */
  RERANK_TITLE_TERM_BONUS: 0.05,

  /**
   * Bonus per extracted search term found in any entry alias.
   * Slightly lower than title bonus since aliases are broader.
   */
  RERANK_ALIAS_TERM_BONUS: 0.04,

  /**
   * Minimum number of extracted terms required to activate app-layer reranking.
   * Single-term queries do not benefit from multi-term reranking.
   */
  RERANK_MIN_TERMS: 2,
} as const;
