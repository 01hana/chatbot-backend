import { Injectable, Logger } from '@nestjs/common';
import { QueryNormalizer } from './utils/query-normalizer.js';
import { QueryTypeClassifier } from './classifiers/query-type.classifier.js';
import { SupportabilityClassifier } from './classifiers/supportability.classifier.js';
import { RetrievalPlanBuilder } from './builders/retrieval-plan.builder.js';
import { TokenizerProviderService } from './tokenizers/tokenizer-provider.service.js';
import { QueryUnderstandingResult } from './types/query-understanding-result.type.js';
import { TokenType } from './types/token-type.enum.js';
import { QueryType } from './types/query-type.enum.js';
import { QueryToken } from './types/query-token.type.js';
import { RetrievalPlan } from './types/retrieval-plan.type.js';

/**
 * QueryUnderstandingService — orchestrates the V2 query understanding pipeline.
 *
 * Pipeline steps:
 *   1. Normalise raw query (full-width → half-width, trim, collapse spaces).
 *   2. Resolve tokenizer from TokenizerProviderService.
 *   3. Tokenise normalised query.
 *   4. Classify query type (QueryTypeClassifier).
 *   5. Classify supportability (SupportabilityClassifier — may query DB).
 *   6. Build retrieval plan (RetrievalPlanBuilder).
 *   7. Assemble and return QueryUnderstandingResult.
 *
 * The service must never throw — all errors produce a safe fallback result
 * so that the caller (ChatPipelineService, Phase 4) can continue safely.
 */
@Injectable()
export class QueryUnderstandingService {
  private readonly logger = new Logger(QueryUnderstandingService.name);

  constructor(
    private readonly tokenizerProvider: TokenizerProviderService,
    private readonly supportabilityClassifier: SupportabilityClassifier,
  ) {}

  /**
   * Run the full query understanding pipeline.
   *
   * @param rawQuery  The original user query string.
   * @param language  ISO language tag: 'zh-TW' | 'en'.
   * @returns         A complete `QueryUnderstandingResult`; never throws.
   */
  async understand(
    rawQuery: string,
    language: string,
  ): Promise<QueryUnderstandingResult> {
    const startMs = Date.now();

    try {
      return await this.runPipeline(rawQuery, language, startMs);
    } catch (err) {
      this.logger.error(
        `QueryUnderstandingService.understand() failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
      return this.safeFallback(rawQuery, language, startMs);
    }
  }

  // ── Private pipeline ───────────────────────────────────────────────────────

  private async runPipeline(
    rawQuery: string,
    language: string,
    startMs: number,
  ): Promise<QueryUnderstandingResult> {
    const lang = language || 'zh-TW';

    // ── Step 1: Normalise ──────────────────────────────────────────────────
    const normalizedQuery = QueryNormalizer.normalize(rawQuery, lang);

    // ── Step 2+3: Tokenise ─────────────────────────────────────────────────
    const tokenizer = this.tokenizerProvider.getTokenizer(lang);
    const tokens: QueryToken[] = await tokenizer.tokenize(normalizedQuery, lang);

    // ── Step 4: Classify query type ────────────────────────────────────────
    const queryType: QueryType = QueryTypeClassifier.classify(tokens, normalizedQuery);

    // ── Step 5: Classify supportability ───────────────────────────────────
    const supportResult = await this.supportabilityClassifier.classify(
      queryType,
      tokens,
      lang,
    );

    // ── Step 6: Build retrieval plan ───────────────────────────────────────
    const effectiveLanguage = lang || 'zh-TW';
    const retrievalPlan: RetrievalPlan = RetrievalPlanBuilder.build(
      tokens,
      queryType,
      supportResult.status,
      effectiveLanguage,
    );

    // ── Step 7: Key phrases (weight ≥ 0.7, non-Noise) ─────────────────────
    const keyPhrases = tokens.filter(
      (t) =>
        t.weight >= 0.7 &&
        t.tokenType !== TokenType.Noise &&
        t.tokenType !== TokenType.Unknown,
    );

    return {
      rawQuery,
      normalizedQuery,
      language: lang,
      tokenizer: this.tokenizerProvider.getLastUsedName(),
      tokens,
      keyPhrases,
      queryType,
      supportability: supportResult.status,
      ...(supportResult.reason !== undefined
        ? { unsupportedReason: supportResult.reason }
        : {}),
      retrievalPlan,
      debugMeta: {
        durationMs: Date.now() - startMs,
        tokenizerUsed: this.tokenizerProvider.getLastUsedName(),
        timestamp: new Date().toISOString(),
      },
    };
  }

  // ── Fallback (on unexpected error) ────────────────────────────────────────

  private safeFallback(
    rawQuery: string,
    language: string,
    startMs: number,
  ): QueryUnderstandingResult {
    const lang = language || 'zh-TW';
    return {
      rawQuery,
      normalizedQuery: rawQuery,
      language: lang,
      tokenizer: 'rule-based',
      tokens: [],
      keyPhrases: [],
      queryType: QueryType.Unknown,
      supportability: 'unsupported',
      unsupportedReason: 'pipeline_error',
      retrievalPlan: {
        searchTerms: [],
        strategies: ['keyword'],
        maxResults: 5,
        language: lang,
      },
      debugMeta: {
        durationMs: Date.now() - startMs,
        tokenizerUsed: 'rule-based',
        timestamp: new Date().toISOString(),
      },
    };
  }
}
