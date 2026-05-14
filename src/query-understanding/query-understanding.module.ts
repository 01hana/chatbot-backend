import { Module } from '@nestjs/common';
import { TokenizerProviderService } from './tokenizers/tokenizer-provider.service.js';
import { KnowledgeAvailabilityChecker } from './classifiers/knowledge-availability-checker.js';
import { SupportabilityClassifier } from './classifiers/supportability.classifier.js';
import { QueryUnderstandingService } from './query-understanding.service.js';

/**
 * QueryUnderstandingModule — 003 QU V2 module (Phase 1 wired, T026).
 *
 * Provides:
 *   - TokenizerProviderService   (Phase 1: RuleBasedTokenizerAdapter only)
 *   - KnowledgeAvailabilityChecker (dual-source DB checker with TTL cache)
 *   - SupportabilityClassifier
 *   - QueryUnderstandingService  (main entry point for callers)
 *
 * Exports QueryUnderstandingService so ChatModule (Phase 4) can inject it.
 *
 * PrismaService is available globally via @Global() PrismaModule registered
 * in AppModule; no explicit import is needed here.
 *
 * Feature flag: feature.query_understanding_v2_enabled
 * When false (default), ChatPipelineService continues to use the existing
 * 002 QueryAnalysisService at src/query-analysis/. This module is registered
 * in the app but its service is not called unless the flag is true.
 */
@Module({
  providers: [
    TokenizerProviderService,
    KnowledgeAvailabilityChecker,
    SupportabilityClassifier,
    QueryUnderstandingService,
  ],
  exports: [QueryUnderstandingService],
})
export class QueryUnderstandingModule {}
