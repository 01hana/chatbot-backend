import { Module } from '@nestjs/common';
import { RetrievalModule } from '../retrieval/retrieval.module.js';
import { KeywordRetriever } from './retrievers/keyword.retriever.js';
import {
  VectorRetrieverStub,
} from './retrievers/vector.retriever.stub.js';
import { VECTOR_RETRIEVER } from './retrievers/vector.retriever.interface.js';
import {
  GraphRetrieverStub,
} from './retrievers/graph.retriever.stub.js';
import { GRAPH_RETRIEVER } from './retrievers/graph.retriever.interface.js';
import { RetrievalFusionService } from './fusion/retrieval-fusion.service.js';
import { RerankerService } from './fusion/reranker.service.js';
import { HybridRetrievalService } from './hybrid-retrieval.service.js';
import { RetrievalDecisionService } from './gate/retrieval-decision.service.js';

/**
 * HybridRetrievalModule — Phase 3 (T050) full wiring.
 *
 * Providers (T041–T049):
 *   - KeywordRetriever          — calls RETRIEVAL_SERVICE (PostgresRetrievalService)
 *   - VECTOR_RETRIEVER token    — bound to VectorRetrieverStub (V1: always [])
 *   - GRAPH_RETRIEVER token     — bound to GraphRetrieverStub  (V1: always [])
 *   - RetrievalFusionService    — deduplicates hits from all three retrievers
 *   - RerankerService           — BM25-style term bonus, sort descending
 *   - HybridRetrievalService    — orchestrates retrieve → fuse → rerank → slice
 *   - RetrievalDecisionService  — no-answer gate (hybrid + legacy paths)
 *
 * Exports:
 *   - HybridRetrievalService    — consumed by ChatPipelineService (Phase 4)
 *   - RetrievalDecisionService  — consumed by ChatPipelineService (Phase 4)
 *
 * Feature flag: feature.hybrid_retrieval_enabled
 * When false (default), ChatPipelineService continues to use the existing
 * legacy PostgresRetrievalService path unchanged.
 */
@Module({
  imports: [RetrievalModule],
  providers: [
    KeywordRetriever,
    VectorRetrieverStub,
    {
      provide: VECTOR_RETRIEVER,
      useExisting: VectorRetrieverStub,
    },
    GraphRetrieverStub,
    {
      provide: GRAPH_RETRIEVER,
      useExisting: GraphRetrieverStub,
    },
    RetrievalFusionService,
    RerankerService,
    HybridRetrievalService,
    RetrievalDecisionService,
  ],
  exports: [HybridRetrievalService, RetrievalDecisionService],
})
export class HybridRetrievalModule {}
