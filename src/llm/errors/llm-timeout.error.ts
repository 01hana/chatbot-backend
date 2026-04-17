/**
 * Thrown by an LLM provider when the per-call timeout expires before
 * the stream or response completes.
 *
 * Distinguishable from a client-triggered abort (`AbortError`) so that
 * `ChatPipelineService` can emit the correct SSE event:
 *   - `LlmTimeoutError` → `event: timeout`
 *   - caller `AbortSignal` fired → `event: interrupted`
 *   - other errors → `event: error`
 */
export class LlmTimeoutError extends Error {
  constructor(message = 'LLM call timed out') {
    super(message);
    this.name = 'LlmTimeoutError';
  }
}
