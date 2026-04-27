/**
 * The four answer-path strategies that `AnswerTemplateResolver.resolve()` can return.
 *
 * - `template`      — The top RAG entry has `answerType='template'`.  Its
 *                     `content` is returned verbatim as `resolvedContent`.
 *                     LLM is **not** called.  Output is deterministic.
 *
 * - `rag+template`  — The top RAG entry has `answerType='rag+template'`.
 *                     The entry's content is filled into an `IntentTemplate`
 *                     text (zh-TW or en depending on `language`).  LLM is
 *                     **not** called.  Output is deterministic.
 *
 * - `rag`           — Normal RAG + LLM path.  001 behaviour (the default for
 *                     all existing knowledge entries).  `resolvedContent` is
 *                     not set by the resolver.
 *
 * - `llm`           — Direct LLM path with no RAG context (entry has
 *                     `answerType='llm'` or there are no RAG results).
 */
export type AnswerStrategy = 'template' | 'rag+template' | 'rag' | 'llm';

/**
 * Output of `AnswerTemplateResolver.resolve()`.
 *
 * When `strategy` is `'template'` or `'rag+template'`, `resolvedContent`
 * contains the final response text that should be sent directly to the client
 * — **no LLM call is needed**.
 */
export interface TemplateResolution {
  /** The chosen answer path. */
  strategy: AnswerStrategy;

  /**
   * Final response text, present only for `template` and `rag+template`
   * strategies.  The pipeline should send this via SSE token event and then
   * emit the done event without calling the LLM.
   */
  resolvedContent?: string;

  /**
   * Human-readable reason for the chosen strategy.
   * Included in the audit log `eventData` for debugging.
   */
  reason: string;
}
