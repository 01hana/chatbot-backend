import { Injectable } from '@nestjs/common';
import { QueryToken } from '../types/query-token.type.js';
import { QueryType } from '../types/query-type.enum.js';
import { SupportabilityStatus } from '../types/query-understanding-result.type.js';
import { TokenType } from '../types/token-type.enum.js';
import { KnowledgeAvailabilityChecker } from './knowledge-availability-checker.js';

// ── Result type ───────────────────────────────────────────────────────────────

/**
 * SupportabilityClassificationResult — output of `SupportabilityClassifier.classify()`.
 *
 * Kept local to this module; callers (QueryUnderstandingService) should
 * destructure into the two separate fields on `QueryUnderstandingResult`.
 */
export interface SupportabilityClassificationResult {
  /** Whether the system can answer the query */
  status: SupportabilityStatus;
  /**
   * Machine-readable reason code when `status='unsupported'`.
   * Not present when `status='supported'` or `status='unknown'`.
   */
  reason?: string;
}

// ── Classifier ────────────────────────────────────────────────────────────────

/**
 * SupportabilityClassifier — determines whether the system is capable of
 * answering the classified query.
 *
 * Evaluation order:
 *   1. All tokens are noise → unsupported ('all_tokens_noise')
 *   2. QueryType is Unsupported → unsupported ('classifier_unsupported')
 *   2b. QueryType is Unknown → unsupported ('unknown_query_type')
 *   3. KB has no content for the (queryType, language) pair
 *      → unsupported ('no_kb_content_for_<queryType>')
 *   4. Otherwise → supported
 *
 * Constraints:
 *   - Does NOT call LLM.
 *   - Does NOT perform retrieval.
 *   - Does NOT modify ChatPipeline.
 */
@Injectable()
export class SupportabilityClassifier {
  constructor(
    private readonly availabilityChecker: KnowledgeAvailabilityChecker,
  ) {}

  /**
   * Classify whether the system supports answering the given query.
   *
   * @param queryType  The classified intent from `QueryTypeClassifier`.
   * @param tokens     All tokens produced by the tokenizer.
   * @param language   ISO language tag of the query ('zh-TW' | 'en').
   * @returns A result object with `status` and optional `reason`.
   */
  async classify(
    queryType: QueryType,
    tokens: QueryToken[],
    language: string,
  ): Promise<SupportabilityClassificationResult> {
    // ── Rule 1: all tokens are noise ─────────────────────────────────────
    const allNoise =
      tokens.length > 0 &&
      tokens.every(
        (t) => t.tokenType === TokenType.Noise || t.tokenType === TokenType.Unknown,
      );
    if (allNoise) {
      return { status: 'unsupported', reason: 'all_tokens_noise' };
    }

    // ── Rule 2: QueryTypeClassifier explicitly marked this unsupported ────
    if (queryType === QueryType.Unsupported) {
      return { status: 'unsupported', reason: 'classifier_unsupported' };
    }

    // ── Rule 2b: queryType could not be classified ────────────────────────
    // Unknown means we have no structured intent; calling hasContentFor() with
    // hint=null would match ANY KB content which is misleading.
    if (queryType === QueryType.Unknown) {
      return { status: 'unsupported', reason: 'unknown_query_type' };
    }

    // ── Rule 3: KB has no relevant content ───────────────────────────────
    const hasContent = await this.availabilityChecker.hasContentFor(queryType, language);
    if (!hasContent) {
      return {
        status: 'unsupported',
        reason: `no_kb_content_for_${queryType}`,
      };
    }

    // ── Supported ─────────────────────────────────────────────────────────
    return { status: 'supported' };
  }
}
