import { Module } from '@nestjs/common';

/**
 * QueryUnderstandingModule — 003 QU V2 scaffolding (Phase 0 empty shell).
 *
 * Providers will be added in Phase 1 (T026) after core types and services
 * are implemented (T012–T025).
 *
 * Feature flag: feature.query_understanding_v2_enabled
 * When false (default), ChatPipelineService continues to use the existing
 * 002 QueryAnalysisService at src/query-analysis/.
 */
@Module({})
export class QueryUnderstandingModule {}
