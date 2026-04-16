import { LlmChatRequest, LlmChatResponse, LlmStreamChunk } from '../types/llm.types';

/**
 * ILlmProvider — provider-agnostic abstraction for LLM interactions.
 *
 * All chat-pipeline code depends on this interface, NOT on any concrete SDK.
 * This allows the real OpenAI implementation (T2-004) to be swapped in later,
 * and future providers (Claude, Gemini, …) to implement the same contract.
 */
export interface ILlmProvider {
  /**
   * Non-streaming completion — useful for short summarisation tasks.
   */
  chat(request: LlmChatRequest): Promise<LlmChatResponse>;

  /**
   * Streaming completion — primary path for the chat pipeline.
   *
   * The returned `AsyncIterable` yields `LlmStreamChunk` objects.
   * Callers must honour `AbortSignal` to cancel mid-stream when the client
   * disconnects.
   *
   * @param request - Chat request payload.
   * @param signal  - Optional AbortSignal; when aborted the iterable should
   *                  stop emitting and throw/return.
   */
  stream(request: LlmChatRequest, signal?: AbortSignal): AsyncIterable<LlmStreamChunk>;
}

/** DI injection token for ILlmProvider. */
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
