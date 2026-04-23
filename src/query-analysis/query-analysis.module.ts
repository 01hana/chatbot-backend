import { Module } from '@nestjs/common';
import { QueryAnalysisService } from './query-analysis.service';
import { DbQueryRuleProvider } from './providers/db-query-rule-provider';
import { GlossaryExpansionProvider } from './providers/glossary-expansion-provider';
import { QUERY_RULE_PROVIDER } from './interfaces/query-rule-provider.interface';
import { QUERY_EXPANSION_PROVIDER } from './interfaces/query-expansion-provider.interface';
import { QUERY_ANALYZER } from './interfaces/query-analyzer.interface';
import type { IQueryRuleProvider } from './interfaces/query-rule-provider.interface';
import type { IQueryExpansionProvider } from './interfaces/query-expansion-provider.interface';
import { RuleBasedQueryAnalyzer } from './analyzers/rule-based-query-analyzer';
import { IntentModule } from '../intent/intent.module';
import { SystemConfigRankProfileProvider } from '../retrieval/providers/system-config-rank-profile-provider';

/**
 * QueryAnalysisModule — NestJS module for the query analysis pipeline.
 *
 * Provider wiring:
 *  - DbQueryRuleProvider registered under QUERY_RULE_PROVIDER token.
 *  - GlossaryExpansionProvider registered under QUERY_EXPANSION_PROVIDER token.
 *  - RuleBasedQueryAnalyzer (with both providers) registered under QUERY_ANALYZER token.
 *  - QueryAnalysisService resolves the analyzer via QUERY_ANALYZER.
 *  - SystemConfigRankProfileProvider exported for retrieval scoring (QA-004).
 *
 * IntentModule is imported for GlossaryExpansionProvider's glossary cache access.
 * SystemConfigModule is @Global() so no explicit import is needed.
 */
@Module({
  imports: [IntentModule],
  providers: [
    QueryAnalysisService,
    DbQueryRuleProvider,
    GlossaryExpansionProvider,
    SystemConfigRankProfileProvider,
    {
      provide: QUERY_RULE_PROVIDER,
      useExisting: DbQueryRuleProvider,
    },
    {
      provide: QUERY_EXPANSION_PROVIDER,
      useExisting: GlossaryExpansionProvider,
    },
    {
      provide: QUERY_ANALYZER,
      useFactory: (
        ruleProvider: IQueryRuleProvider,
        expansionProvider: IQueryExpansionProvider,
      ) => new RuleBasedQueryAnalyzer(ruleProvider, expansionProvider),
      inject: [QUERY_RULE_PROVIDER, QUERY_EXPANSION_PROVIDER],
    },
  ],
  exports: [QueryAnalysisService, SystemConfigRankProfileProvider],
})
export class QueryAnalysisModule {}
