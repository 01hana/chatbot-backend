import { QueryToken } from '../types/query-token.type.js';
import { QueryType } from '../types/query-type.enum.js';
import { RetrievalPlan } from '../types/retrieval-plan.type.js';
import { SupportabilityStatus } from '../types/query-understanding-result.type.js';
import { TokenType } from '../types/token-type.enum.js';

const DEFAULT_MAX_RESULTS = 5;

/**
 * RetrievalPlanBuilder — converts tokeniser output into a structured plan for
 * the retrieval layer.
 *
 * The retrieval layer must execute the plan as-is; it must NOT perform any
 * additional linguistic analysis (no tokenisation, no stop-word removal, no
 * bigram expansion, no domain-signal inference).
 *
 * Design invariants:
 *   - Noise and Unknown tokens are excluded from `searchTerms`.
 *   - Empty strings are excluded from `searchTerms`.
 *   - `searchTerms` are sorted by descending token weight.
 *   - `language` equals the value passed in; must not be empty.
 */
export class RetrievalPlanBuilder {
  /**
   * Build a retrieval plan from classifier outputs.
   *
   * @param tokens         All tokens produced by the tokenizer.
   * @param queryType      Classified intent (used to select strategies).
   * @param supportability Supportability status (reserved for future strategy hints).
   * @param language       ISO language tag; must not be empty.
   * @returns              A `RetrievalPlan` ready for the retrieval layer.
   * @throws               `Error` when `language` is an empty string.
   */
  static build(
    tokens: QueryToken[],
    queryType: QueryType,
    supportability: SupportabilityStatus,
    language: string,
  ): RetrievalPlan {
    if (!language) {
      throw new Error('RetrievalPlanBuilder.build: language must not be empty');
    }

    const searchTerms = tokens
      // Exclude semantically empty token types
      .filter(
        (t) =>
          t.tokenType !== TokenType.Noise &&
          t.tokenType !== TokenType.Unknown,
      )
      // Sort by descending weight (highest-confidence terms first)
      .sort((a, b) => b.weight - a.weight)
      // Map to normalised text and strip whitespace
      .map((t) => t.normalizedText.trim())
      // Remove any empty strings that survived normalisation
      .filter((term) => term.length > 0);

    return {
      searchTerms,
      strategies: RetrievalPlanBuilder.strategiesFor(queryType, supportability),
      maxResults: DEFAULT_MAX_RESULTS,
      language,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Select retrieval strategies based on query type.
   *
   * Phase 1 uses keyword-only for most types; product queries also request
   * metadata-based filtering as a lightweight second pass.
   * Future phases may add 'vector' or 'graph' strategies.
   */
  private static strategiesFor(
    queryType: QueryType,
    _supportability: SupportabilityStatus,
  ): string[] {
    switch (queryType) {
      case QueryType.ProductLookup:
      case QueryType.ProductComparison:
        return ['keyword', 'metadata'];
      default:
        return ['keyword'];
    }
  }
}
