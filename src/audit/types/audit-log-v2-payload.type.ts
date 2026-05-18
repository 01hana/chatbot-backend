import { AuditLogEvent } from './audit-log-event.type.js';
import { AnswerMode } from '../../chat/types/answer-mode.type.js';
import { AnswerTrace } from '../../chat/types/answer-trace.type.js';
import { SourceReference } from '../../chat/types/source-reference.type.js';
import { QueryUnderstandingResult } from '../../query-understanding/types/index.js';
import { RetrievalPlan } from '../../query-understanding/types/index.js';
import { ChunkResult, RetrievalDecision } from '../../hybrid-retrieval/types/index.js';

/**
 * AuditChunkSummary — slim representation of a ChunkResult for audit logs.
 * Omits 'content' to prevent storing large knowledge base text in audit_log.eventData.
 * Written by default; full ChunkResult written only when feature.audit_verbose_enabled=true.
 */
export interface AuditChunkSummary {
  knowledgeEntryId?: number;
  chunkId?: string;
  sourceKey: string;
  score: number;
  language: string;
}

/**
 * AuditQueryUnderstandingSummary — slim summary of QueryUnderstandingResult.
 * Written when feature.audit_verbose_enabled=false (default).
 * Omits rawQuery, normalizedQuery, full tokens array, and debugMeta.timestamp.
 */
export interface AuditQueryUnderstandingSummary {
  tokenizer: string;
  queryType: string;
  supportability: string;
  /** Normalised text of each high-signal keyPhrase token. */
  keyPhrases: string[];
  durationMs: number;
}

/**
 * AuditRetrievalDecisionSummary — slim summary of RetrievalDecision.
 * topK items use AuditChunkSummary (no content field).
 */
export interface AuditRetrievalDecisionSummary {
  canAnswer: boolean;
  reason: string;
  confidence: number;
  topK: AuditChunkSummary[];
}

/**
 * AuditLogV2Payload — extends the base AuditLogEvent with Phase 5 traceability
 * fields produced by the 003 pipeline path.
 *
 * All new fields are optional so that existing callers that only pass V1
 * `AuditLogEvent` values continue to work without modification.
 *
 * Persistence strategy (Phase 5-C):
 *   These fields are stored inside `eventData` as a JSON blob; they do NOT
 *   correspond to new DB columns, so no migration is required.
 */
export interface AuditLogV2Payload extends AuditLogEvent {
  /**
   * QueryUnderstanding data for the turn.
   * Default (feature.audit_verbose_enabled=false): slim AuditQueryUnderstandingSummary.
   * Verbose (feature.audit_verbose_enabled=true): full QueryUnderstandingResult.
   */
  queryUnderstanding?: AuditQueryUnderstandingSummary | QueryUnderstandingResult;

  /**
   * The RetrievalPlan passed to the retrieval layer.
   * Present when QU V2 is active and a plan was built.
   */
  retrievalPlan?: RetrievalPlan;

  /**
   * Retrieval candidates (post-fusion, pre-gate) for the turn.
   * Default: AuditChunkSummary[] (no content).
   * Verbose (feature.audit_verbose_enabled=true): full ChunkResult[] (with content).
   */
  retrievalCandidates?: AuditChunkSummary[] | ChunkResult[];

  /**
   * Decision produced by RetrievalDecisionService.
   * Default: AuditRetrievalDecisionSummary (topK without content).
   * Verbose (feature.audit_verbose_enabled=true): full RetrievalDecision.
   */
  retrievalDecision?: AuditRetrievalDecisionSummary | RetrievalDecision;

  /**
   * The pipeline path that produced the answer.
   * Always set by Phase 5+ pipeline; absent for pre-Phase-5 events.
   */
  answerMode?: AnswerMode;

  /**
   * Knowledge sources referenced in the answer.
   * Empty array when answerMode='fallback' or no sources were used.
   */
  sourceReferences?: SourceReference[];

  /**
   * Whether the LLM was called during this turn.
   * Required for SC-001 compliance (domain-out queries must have llmCalled=false).
   */
  llmCalled?: boolean;

  /**
   * Whether the no-answer gate allowed the pipeline to proceed to LLM/template.
   * Absent when `feature.no_answer_gate_enabled=false`.
   */
  canAnswer?: boolean;

  /**
   * Machine-readable reason when `canAnswer=false`.
   * Matches RetrievalDecision.reason values (no_results | low_score | unsupported | all_tokens_noise).
   */
  fallbackReason?: string;

  /**
   * Detailed timing and retrieval trace.
   * Present only when `feature.traceable_answer_enabled=true`.
   */
  trace?: AnswerTrace;
}
