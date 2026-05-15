import { Injectable } from '@nestjs/common';
import type { ChunkResult } from '../types/chunk-result.type.js';
import type {
  RetrievalDecision,
  RetrievalDecisionReason,
} from '../types/retrieval-decision.type.js';
import type { QueryUnderstandingResult } from '../../query-understanding/types/query-understanding-result.type.js';
import type { RetrievalResult } from '../../retrieval/types/retrieval.types.js';
import { TokenType } from '../../query-understanding/types/token-type.enum.js';

/** All valid reason codes — used to validate unsupportedReason strings. */
const KNOWN_REASONS = new Set<string>([
  'ok',
  'no_results',
  'low_score',
  'unsupported',
  'all_tokens_noise',
  'unknown_query_type',
]);

/**
 * RetrievalDecisionService — No-answer Gate logic (T049).
 *
 * Decides whether the pipeline should proceed to answer generation or emit a
 * fallback response. Supports two entry points:
 *
 *  • `decideFromChunks`          — Hybrid path (Phase 3 V1+).
 *  • `decideFromRetrievalResults` — Legacy path (Phase 4 Step 6 legacy).
 *
 * No LLM calls, no DB queries, no tokenisation.
 * Evaluate order: no_results → low_score → unsupported → all_tokens_noise → ok
 */
@Injectable()
export class RetrievalDecisionService {
  /**
   * Hybrid path: evaluate a list of ChunkResults already produced by
   * HybridRetrievalService.
   *
   * @param chunks              Results from HybridRetrievalService.retrieve().
   * @param understandingResult Optional QU V2 result; only score-based checks
   *                            are applied when undefined.
   * @param minScore            Minimum acceptable top score threshold.
   */
  decideFromChunks(
    chunks: ChunkResult[],
    understandingResult: QueryUnderstandingResult | undefined,
    minScore: number,
  ): RetrievalDecision {
    return this.evaluate(chunks, understandingResult, minScore);
  }

  /**
   * Legacy path: evaluate a list of RetrievalResult[] produced by the
   * existing PostgresRetrievalService. Converts to ChunkResult[] internally
   * so ChatPipelineService does not need to handle the conversion.
   *
   * @param results             Results from IRetrievalService.retrieve().
   * @param understandingResult Optional QU V2 result.
   * @param minScore            Minimum acceptable top score threshold.
   */
  decideFromRetrievalResults(
    results: RetrievalResult[],
    understandingResult: QueryUnderstandingResult | undefined,
    minScore: number,
  ): RetrievalDecision {
    const chunks = results.map((r) => this.resultToChunk(r));
    return this.evaluate(chunks, understandingResult, minScore);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Core evaluation pipeline.
   *
   * Order:
   *   1. no results       → no_results
   *   2. low top score    → low_score
   *   3. supportability=unsupported → unsupportedReason ?? 'unsupported'
   *   4. all tokens noise → all_tokens_noise
   *   5. default          → ok
   */
  private evaluate(
    chunks: ChunkResult[],
    understandingResult: QueryUnderstandingResult | undefined,
    minScore: number,
  ): RetrievalDecision {
    // 1. No results
    if (chunks.length === 0) {
      return { canAnswer: false, reason: 'no_results', confidence: 0, topK: [] };
    }

    const sorted = [...chunks].sort((a, b) => b.score - a.score);
    const topScore = sorted[0].score;

    // 2. Low score
    if (topScore < minScore) {
      return {
        canAnswer: false,
        reason: 'low_score',
        confidence: topScore,
        topK: sorted,
      };
    }

    if (understandingResult !== undefined) {
      // 3. Query explicitly marked as unsupported
      if (understandingResult.supportability === 'unsupported') {
        const rawReason = understandingResult.unsupportedReason ?? 'unsupported';
        const reason = this.toDecisionReason(rawReason);
        return { canAnswer: false, reason, confidence: topScore, topK: sorted };
      }

      // 4. All query tokens are Noise
      const hasTokens = understandingResult.tokens.length > 0;
      const allNoise =
        hasTokens &&
        understandingResult.tokens.every((t) => t.tokenType === TokenType.Noise);
      if (allNoise || understandingResult.unsupportedReason === 'all_tokens_noise') {
        return {
          canAnswer: false,
          reason: 'all_tokens_noise',
          confidence: topScore,
          topK: sorted,
        };
      }
    }

    // 5. OK
    return { canAnswer: true, reason: 'ok', confidence: topScore, topK: sorted };
  }

  /**
   * Narrows an arbitrary unsupportedReason string to a known
   * RetrievalDecisionReason, falling back to 'unsupported'.
   */
  private toDecisionReason(raw: string): RetrievalDecisionReason {
    return KNOWN_REASONS.has(raw) ? (raw as RetrievalDecisionReason) : 'unsupported';
  }

  /**
   * Converts a legacy RetrievalResult to ChunkResult.
   * sourceKey defaults to '' when the entry has no sourceKey.
   */
  private resultToChunk(r: RetrievalResult): ChunkResult {
    return {
      knowledgeEntryId: r.entry.id,
      sourceKey: r.entry.sourceKey ?? '',
      content: r.entry.content,
      score: r.score,
      language: r.entry.language,
      isCrossLanguageFallback: r.isCrossLanguageFallback,
    };
  }
}
