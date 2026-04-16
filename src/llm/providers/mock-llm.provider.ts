import { Injectable, Logger } from '@nestjs/common';
import { ILlmProvider } from '../interfaces/llm-provider.interface';
import { LlmChatRequest, LlmChatResponse, LlmStreamChunk } from '../types/llm.types';

/**
 * MockLlmProvider — placeholder implementation used until T2-004 (OpenAiProvider)
 * is implemented with a real API key.
 *
 * Behaviour:
 *  - `chat()` returns a fixed response immediately.
 *  - `stream()` yields a few token chunks then a done chunk.
 *  - Respects AbortSignal.
 *
 * Replace this provider by binding `LLM_PROVIDER` to `OpenAiProvider` in
 * `LlmModule` once the real implementation is ready.
 */
@Injectable()
export class MockLlmProvider implements ILlmProvider {
  private readonly logger = new Logger(MockLlmProvider.name);

  private readonly MOCK_RESPONSE =
    '您好！我是震南 AI 客服助理。目前系統正在開發中，尚未串接真實 AI 服務。如需協助，請聯繫業務人員。';

  async chat(request: LlmChatRequest): Promise<LlmChatResponse> {
    this.logger.debug(`MockLlmProvider.chat called with ${request.messages.length} messages`);
    return {
      content: this.MOCK_RESPONSE,
      promptTokens: 10,
      completionTokens: 50,
      totalTokens: 60,
      durationMs: 50,
      model: 'mock',
      provider: 'mock',
    };
  }

  async *stream(request: LlmChatRequest, signal?: AbortSignal): AsyncIterable<LlmStreamChunk> {
    this.logger.debug(`MockLlmProvider.stream called with ${request.messages.length} messages`);

    const tokens = this.MOCK_RESPONSE.split('');
    for (const token of tokens) {
      if (signal?.aborted) return;
      yield { token, done: false };
      // Small artificial delay so the stream looks real in integration tests
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }

    yield {
      token: '',
      done: true,
      usage: { promptTokens: 10, completionTokens: tokens.length, totalTokens: 10 + tokens.length },
    };
  }
}
