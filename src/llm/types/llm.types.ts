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
 * When `done` is true, `usage` carries the final token counts.
 */
export interface LlmStreamChunk {
  token: string;
  done: boolean;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}
