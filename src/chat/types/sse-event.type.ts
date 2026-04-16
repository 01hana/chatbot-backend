/**
 * All possible SSE event types for the chat stream.
 *
 * SSE wire format (per spec):
 *   event: token\ndata: {"token":"..."}\n\n
 *   event: done\ndata: {messageId, action, sourceReferences, usage}\n\n
 *   event: error\ndata: {code, message}\n\n
 *   event: timeout\ndata: {message}\n\n
 *   event: interrupted\ndata: {message}\n\n
 */
export type SseEventType = 'token' | 'done' | 'error' | 'timeout' | 'interrupted';

/** Payload for `event: token` — partial response chunk from the LLM. */
export interface SseTokenPayload {
  token: string;
}

/** `action` values carried in the `done` event. */
export type ChatAction = 'answer' | 'handoff' | 'fallback' | 'intercepted';

/** Token-usage summary attached to the `done` event. */
export interface SseUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** Payload for `event: done` — final event closing a successful stream. */
export interface SseDonePayload {
  messageId: number;
  action: ChatAction;
  sourceReferences: number[];
  usage: SseUsage;
}

/** Payload for `event: error`. */
export interface SseErrorPayload {
  code: string;
  message: string;
}

/** Payload for `event: timeout` or `event: interrupted`. */
export interface SseStatusPayload {
  message: string;
}

/**
 * Helper to format an SSE message string.
 *
 * Example output:
 *   event: token\ndata: {"token":"hello"}\n\n
 */
export function formatSseEvent(event: SseEventType, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
