/**
 * A single message in the LLM conversation history.
 * Matches the OpenAI ChatCompletion message format.
 */
export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Input to an LLM chat or streaming call.
 */
export interface LlmChatRequest {
  messages: LlmMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Full (non-streaming) LLM response.
 */
export interface LlmChatResponse {
  content: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Actual wall-clock time for the LLM call in milliseconds. */
  durationMs: number;
  model: string;
  provider: string;
}

/**
 * A single chunk emitted during LLM streaming.
 *
 * When `done` is false, `token` carries the next partial text.
 * When `done` is true, `usage` carries the final token counts and metadata
 * fields (`modelUsed`, `fallbackTriggered`, `provider`) that the pipeline
 * uses for AuditLog observability — so callers never need to cast.
 */
export interface LlmStreamChunk {
  token: string;
  done: boolean;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** Actual model name used (populated in the final done=true chunk). */
  modelUsed?: string;
  /** True when the primary model failed and a fallback model was used (done=true chunk only). */
  fallbackTriggered?: boolean;
  /** Provider identifier, e.g. "openai" or "mock" (done=true chunk only). */
  provider?: string;
}
