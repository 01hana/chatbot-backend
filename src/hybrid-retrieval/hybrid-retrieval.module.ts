import { Module } from '@nestjs/common';

/**
 * HybridRetrievalModule — 003 hybrid retrieval scaffolding (Phase 0 empty shell).
 *
 * Providers will be added in Phase 3 (T050) after retrievers, fusion,
 * reranker, and RetrievalDecisionService are implemented (T041–T049).
 *
 * Feature flag: feature.hybrid_retrieval_enabled
 * When false (default), ChatPipelineService continues to use the existing
 * legacy PostgresRetrievalService.
 */
@Module({})
export class HybridRetrievalModule {}
