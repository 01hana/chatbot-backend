import { Injectable } from '@nestjs/common';
import { ChunkResult } from '../types/chunk-result.type.js';
import { RetrievalPlan } from '../../query-understanding/types/retrieval-plan.type.js';

/** Maximum term bonus added to a result's score. */
const MAX_TERM_BONUS = 0.15;
/** Score bonus per matched search term. */
const BONUS_PER_TERM = 0.03;

/**
 * RerankerService — BM25-style term-presence reranker.
 *
 * Adds a small score bonus for each search term from the RetrievalPlan that
 * appears in the result's content (case-insensitive substring match).
 * The total bonus is capped at MAX_TERM_BONUS (0.15).
 * Results are returned sorted by final score (highest first).
 *
 * STRICT BOUNDARY: No tokenisation or new linguistic analysis is introduced.
 * Only plan.searchTerms (pre-computed by QueryUnderstandingService) are used.
 */
@Injectable()
export class RerankerService {
  /**
   * Rerank retrieval results using BM25-style term presence bonus.
   *
   * @param results  Fused ChunkResult array from RetrievalFusionService.
   * @param plan     RetrievalPlan containing the pre-computed searchTerms.
   * @returns        Results sorted by adjusted score (descending).
   */
  rerank(results: ChunkResult[], plan: RetrievalPlan): ChunkResult[] {
    return results
      .map((r) => {
        const bonus = this.computeBonus(r.content, plan.searchTerms);
        return { ...r, score: Math.min(1, r.score + bonus) } as ChunkResult;
      })
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Compute the total term-presence bonus for a content string.
   *
   * Each search term that appears in the content (case-insensitive) contributes
   * BONUS_PER_TERM (0.03) to the bonus, capped at MAX_TERM_BONUS (0.15).
   */
  private computeBonus(content: string, searchTerms: string[]): number {
    const lower = content.toLowerCase();
    let hits = 0;
    for (const term of searchTerms) {
      const normalizedTerm = term.trim().toLowerCase();
      if (!normalizedTerm) {
        continue;
      }
      if (lower.includes(normalizedTerm)) {
        hits++;
      }
    }
    return Math.min(hits * BONUS_PER_TERM, MAX_TERM_BONUS);
  }
}
