/**
 * AuditLogEvent — all fields that can be written to a single AuditLog row.
 *
 * Token-usage fields default to 0 when the LLM was not called (e.g. a
 * PromptGuard block or a low-confidence knowledge miss).
 */
export interface AuditLogEvent {
  /** X-Request-ID from the HTTP request (traceability). */
  requestId?: string;
  /** References Conversation.sessionId (not FK — intentional). */
  sessionId?: string;
  /**
   * Event type identifier.
   * Common values: chat_response | prompt_guard_blocked | confidential_refused |
   * sensitive_intent_alert | llm_fallback | lead_created | ticket_created
   */
  eventType: string;
  /** Arbitrary JSON payload specific to the event type. */
  eventData?: Record<string, unknown>;
  /** Array of KnowledgeEntry IDs referenced in the RAG step. */
  knowledgeRefs?: string[];
  /** Top RAG similarity score for this turn. Null when RAG was skipped. */
  ragConfidence?: number;
  /** Human-readable block reason (PromptGuard / confidentiality check). */
  blockedReason?: string;
  /** SHA-256 hex digest of the raw user input. */
  promptHash?: string;
  /** Number of prompt tokens consumed by the LLM call (0 when not called). */
  promptTokens?: number;
  /** Number of completion tokens produced by the LLM call (0 when not called). */
  completionTokens?: number;
  /** Total tokens (promptTokens + completionTokens). */
  totalTokens?: number;
  /** Actual wall-clock duration of the pipeline turn in milliseconds. */
  durationMs?: number;
  /** LLM model identifier (e.g. "gpt-5.4-mini"). Null when LLM not called. */
  aiModel?: string;
  /** LLM provider identifier (e.g. "openai"). Null when LLM not called. */
  aiProvider?: string;
  /** Snapshot of relevant SystemConfig values at the time of the event. */
  configSnapshot?: Record<string, unknown>;
}
