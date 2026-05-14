import { QueryType } from './query-type.enum.js';
import { QueryToken } from './query-token.type.js';
import { RetrievalPlan } from './retrieval-plan.type.js';

/**
 * SupportabilityStatus — single-value status string returned by SupportabilityClassifier.
 *
 * - 'supported'   — the system can answer this query
 * - 'unsupported' — the system explicitly cannot answer (all-noise, no KB content, etc.)
 * - 'unknown'     — supportability could not be determined (e.g. classifier error)
 */
export type SupportabilityStatus = 'supported' | 'unsupported' | 'unknown';

/**
 * QueryDebugMeta — timing and tracing metadata attached to the result.
 * Populated when feature.traceable_answer_enabled=true or in non-production.
 */
export interface QueryDebugMeta {
  /** Wall-clock time for the full understand() call in milliseconds */
  durationMs: number;
  /** Name of the tokenizer that was actually used */
  tokenizerUsed: string;
  /** ISO timestamp of when understand() was called */
  timestamp: string;
}

/**
 * QueryUnderstandingResult — full output of QueryUnderstandingService.understand().
 *
 * Passed as ctx.queryUnderstandingResult in ChatPipelineService (Phase 4).
 * All fields are readonly to prevent accidental mutation downstream.
 */
export interface QueryUnderstandingResult {
  /** Original raw query string from the user */
  readonly rawQuery: string;
  /** Normalised query after full-width conversion, trim, whitespace collapse */
  readonly normalizedQuery: string;
  /** ISO language tag: 'zh-TW' | 'en' */
  readonly language: string;
  /** Name of the tokenizer that produced the tokens */
  readonly tokenizer: string;
  /** All classified tokens from the tokenizer */
  readonly tokens: QueryToken[];
  /**
   * High-signal tokens (weight ≥ 0.7, non-Noise).
   * Used as the primary source for RetrievalPlan.searchTerms.
   */
  readonly keyPhrases: QueryToken[];
  /** High-level intent classification */
  readonly queryType: QueryType;
  /** Whether the system supports answering this query */
  readonly supportability: SupportabilityStatus;
  /**
   * Machine-readable reason code when supportability='unsupported'.
   * E.g. 'all_tokens_noise' | 'unsupported_query_type' | 'no_kb_content' | 'language_not_supported'
   */
  readonly unsupportedReason?: string;
  /** Retrieval instructions produced for the retrieval layer */
  readonly retrievalPlan: RetrievalPlan;
  /** Timing and tracing metadata */
  readonly debugMeta: QueryDebugMeta;
}
