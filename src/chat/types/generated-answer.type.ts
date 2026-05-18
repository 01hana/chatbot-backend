import { AnswerMode } from './answer-mode.type.js';
import type { AnswerTrace } from './answer-trace.type.js';
import { SourceReference } from './source-reference.type.js';

/**
 * GeneratedAnswer — the assembled result returned by the ChatPipeline for a turn.
 *
 * `sourceReferences` is always present (may be an empty array when the answer
 * did not draw from any knowledge source, e.g. answerMode='fallback').
 *
 * `trace` is only populated when the `feature.traceable_answer_enabled` flag is
 * `true`; it is intentionally absent otherwise to keep SSE payloads lean.
 */
export interface GeneratedAnswer {
  /** The text content of the reply sent to the end user. */
  message: string;

  /**
   * Knowledge sources that contributed to this answer.
   * Always an array — empty when no sources were used (fallback / template).
   */
  sourceReferences: SourceReference[];

  /** The pipeline path that produced this answer. */
  answerMode: AnswerMode;

  /** Confidence score for the answer (0–1). */
  confidence: number;

  /**
   * Detailed timing and retrieval trace.
   * Present only when `feature.traceable_answer_enabled=true`.
   */
  trace?: AnswerTrace;
}
