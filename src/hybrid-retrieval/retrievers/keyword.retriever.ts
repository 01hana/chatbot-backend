import { Inject, Injectable } from '@nestjs/common';
import type { IRetrievalService } from '../../retrieval/interfaces/retrieval-service.interface.js';
import { RETRIEVAL_SERVICE } from '../../retrieval/interfaces/retrieval-service.interface.js';
import type { RetrievalResult } from '../../retrieval/types/retrieval.types.js';
import { RetrievalPlan } from '../../query-understanding/types/retrieval-plan.type.js';
import { ChunkResult } from '../types/chunk-result.type.js';

/**
 * KeywordRetriever — Phase 3 V1 keyword retrieval adapter.
 *
 * Calls the existing PostgresRetrievalService (via RETRIEVAL_SERVICE DI token)
 * once per search term in the RetrievalPlan, then deduplicates results by
 * knowledgeEntryId, keeping the highest score for each entry.
 *
 * STRICT BOUNDARY: This class must NOT contain any tokenisation, stop-word
 * filtering, bigram expansion, domain-signal logic, or supportability checks.
 * All linguistic analysis is done upstream by QueryUnderstandingService.
 */
@Injectable()
export class KeywordRetriever {
  constructor(
    @Inject(RETRIEVAL_SERVICE)
    private readonly retrievalService: IRetrievalService,
  ) {}

  /**
   * Retrieve knowledge entries for each term in the plan, then merge and
   * deduplicate results by `knowledgeEntryId` (keeping highest score).
   *
   * @param plan  RetrievalPlan produced by QueryUnderstandingService.
   * @returns     Deduplicated ChunkResult array, unsorted (caller sorts).
   */
  async retrieve(plan: RetrievalPlan): Promise<ChunkResult[]> {
    const bestByEntryId = new Map<number, ChunkResult>();

    for (const term of plan.searchTerms) {
      const results = await this.retrievalService.retrieve({
        query: term,
        language: plan.language,
        limit: plan.maxResults,
      });

      for (const r of results) {
        const entryId = r.entry.id;
        const existing = bestByEntryId.get(entryId);
        if (!existing || r.score > existing.score) {
          bestByEntryId.set(entryId, this.toChunkResult(r));
        }
      }
    }

    return Array.from(bestByEntryId.values());
  }

  /**
   * Map a RetrievalResult to a ChunkResult (KnowledgeEntry-based hit).
   * No chunkId is available in V1 (KnowledgeChunk path is Phase 5+).
   */
  private toChunkResult(r: RetrievalResult): ChunkResult {
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
