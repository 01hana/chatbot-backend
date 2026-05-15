import { Inject, Injectable } from '@nestjs/common';
import type { RetrievalPlan } from '../query-understanding/types/retrieval-plan.type.js';
import type { ChunkResult } from './types/chunk-result.type.js';
import { KeywordRetriever } from './retrievers/keyword.retriever.js';
import type { IVectorRetriever } from './retrievers/vector.retriever.interface.js';
import { VECTOR_RETRIEVER } from './retrievers/vector.retriever.interface.js';
import type { IGraphRetriever } from './retrievers/graph.retriever.interface.js';
import { GRAPH_RETRIEVER } from './retrievers/graph.retriever.interface.js';
import { RetrievalFusionService } from './fusion/retrieval-fusion.service.js';
import { RerankerService } from './fusion/reranker.service.js';

/**
 * HybridRetrievalService — Phase 3 V1 orchestrator.
 *
 * Calls all three retrievers in parallel, fuses results, reranks, then
 * returns the top-N hits.
 *
 * V1 behaviour is equivalent to KeywordRetriever + reranking because
 * VectorRetrieverStub and GraphRetrieverStub always return [].
 *
 * STRICT BOUNDARY:
 *   - No tokenisation, bigram, stop-word, or domain-signal logic.
 *   - No LLM calls.
 *   - No ChatPipeline references.
 *   - Uses only the pre-computed RetrievalPlan produced by
 *     QueryUnderstandingService.
 */
@Injectable()
export class HybridRetrievalService {
  constructor(
    private readonly keywordRetriever: KeywordRetriever,
    @Inject(VECTOR_RETRIEVER)
    private readonly vectorRetriever: IVectorRetriever,
    @Inject(GRAPH_RETRIEVER)
    private readonly graphRetriever: IGraphRetriever,
    private readonly fusionService: RetrievalFusionService,
    private readonly rerankerService: RerankerService,
  ) {}

  /**
   * Retrieve the top `limit` results for the given plan.
   *
   * Pipeline:
   *   1. Parallel: keyword + vector stub + graph stub
   *   2. Fuse     (deduplicate by canonical key, keep highest score)
   *   3. Rerank   (BM25-style term bonus, sort descending)
   *   4. Slice    (return first `limit` results)
   *
   * @param plan   RetrievalPlan from QueryUnderstandingService.
   * @param limit  Maximum number of results to return.
   */
  async retrieve(plan: RetrievalPlan, limit: number): Promise<ChunkResult[]> {
    const [keyword, vector, graph] = await Promise.all([
      this.keywordRetriever.retrieve(plan),
      this.vectorRetriever.retrieve(plan, limit),
      this.graphRetriever.retrieve(plan, limit),
    ]);

    const fused = this.fusionService.fuse(keyword, vector, graph);
    const reranked = this.rerankerService.rerank(fused, plan);
    return reranked.slice(0, limit);
  }
}
