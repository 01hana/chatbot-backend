import { Inject, Injectable, Optional } from '@nestjs/common';
import type { AnalyzedQuery } from './types/analyzed-query.type';
import type { IQueryAnalyzer } from './interfaces/query-analyzer.interface';
import { QUERY_ANALYZER } from './interfaces/query-analyzer.interface';
import { RuleBasedQueryAnalyzer } from './analyzers/rule-based-query-analyzer';

/**
 * QueryAnalysisService — public facade for the query analysis pipeline.
 *
 * Delegates all work to an IQueryAnalyzer implementation. The default
 * implementation is RuleBasedQueryAnalyzer (QA-002). When QA-003/QA-004 land,
 * a fully-wired version (with DbQueryRuleProvider + GlossaryExpansionProvider)
 * will be registered under the QUERY_ANALYZER DI token and take precedence.
 *
 * QA-005: ChatPipelineService will call analyze() behind a feature flag.
 */
@Injectable()
export class QueryAnalysisService {
  private readonly analyzer: IQueryAnalyzer;

  constructor(
    @Optional() @Inject(QUERY_ANALYZER) injectedAnalyzer?: IQueryAnalyzer,
  ) {
    // Fall back to the hardcoded default when no DI token is registered.
    this.analyzer = injectedAnalyzer ?? new RuleBasedQueryAnalyzer();
  }

  /**
   * Analyse a raw user query and return a structured AnalyzedQuery.
   *
   * @param raw      Raw, untrimmed user input string.
   * @param language Optional language hint ('zh-TW' | 'en').
   * @returns        Structured AnalyzedQuery; see types/analyzed-query.type.ts
   */
  async analyze(raw: string, language?: string): Promise<AnalyzedQuery> {
    return this.analyzer.analyze(raw, language);
  }
}
