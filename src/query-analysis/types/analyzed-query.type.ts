/**
 * AnalyzedQuery — the structured output of the QueryAnalysisModule.
 *
 * Produced by IQueryAnalyzer.analyze() and consumed by IntentService
 * (for intent routing) and RetrievalService (for ranked retrieval).
 *
 * Field definitions: spec.md FR-QA-001
 */
export interface AnalyzedQuery {
  /** Original, unmodified user input string. */
  rawQuery: string;

  /**
   * Normalised query string after question-shell removal, full-width
   * conversion, stop word filtering and whitespace collapse.
   * Replaces the output of QueryNormalizer.normalize() in the pipeline.
   */
  normalizedQuery: string;

  /** Detected (or provided) language code: 'zh-TW' | 'en'. */
  language: string;

  /**
   * Raw token array produced by ITokenizer.tokenize().
   * Chinese: character/word-boundary heuristic split.
   * English: whitespace split.
   */
  tokens: string[];

  /**
   * High-confidence keyword list used for multi-term reranking.
   * Derived from tokens after noise-word filtering and length thresholding
   * (≥ 2 chars for zh-TW; non-stop-word for en).
   */
  terms: string[];

  /**
   * Multi-word phrase candidates detected via bi-gram sliding window.
   * Examples: ['M3 螺絲', '不鏽鋼螺栓'].
   */
  phrases: string[];

  /**
   * Expanded term list: original terms ∪ glossary synonyms.
   * Populated by IQueryExpansionProvider.expand(); deduplicated.
   */
  expandedTerms: string[];

  /**
   * IDs / names of QueryRule entries that were applied during this analysis.
   * Used for observability and audit logging; not returned to the frontend.
   */
  matchedRules: string[];

  /**
   * Key of the ranking profile selected for this query.
   * Possible values: 'default' | 'faq' | 'product' | 'diagnosis'.
   * Passed to RetrievalService so it can choose appropriate scoring weights.
   */
  selectedProfile: string;

  /**
   * Intent candidates inferred from the query structure.
   * Each entry has a label (e.g. 'product-inquiry') and a confidence score
   * in [0, 1]. Used by IntentService Layer 1 routing (IG-005).
   */
  intentHints: Array<{ label: string; score: number }>;

  /**
   * Debug metadata — written to AuditLog only; never exposed in API responses.
   */
  debugMeta: {
    /** Wall-clock time (ms) for the full analysis pipeline. */
    processingMs: number;

    /** Names of normalisation steps that were applied, in order. */
    normalizerSteps: string[];

    /** Number of glossary expansion hits (synonyms added). */
    expansionHits: number;
  };
}
