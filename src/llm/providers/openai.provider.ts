import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { SystemConfigService } from '../../system-config/system-config.service';
import { ILlmProvider } from '../interfaces/llm-provider.interface';
import { LlmTimeoutError } from '../errors/llm-timeout.error';
import { LlmChatRequest, LlmChatResponse, LlmStreamChunk } from '../types/llm.types';

/**
 * Primary and fallback model names.
 * These are the official OpenAI model IDs — do NOT rename them.
 */
const PRIMARY_MODEL = 'gpt-5.4-mini';
const FALLBACK_MODEL = 'gpt-5.4-nano';

/** Fixed handoff message emitted when both primary and fallback models fail. */
const HANDOFF_MESSAGE = '目前 AI 忙碌中，請留下聯絡資訊或聯絡業務人員，我們將儘速為您服務。';

/** Maximum number of retries for the non-streaming `chat()` method. */
const CHAT_MAX_RETRIES = 2;
/** Delay between retries in milliseconds. */
const CHAT_RETRY_DELAY_MS = 500;

/**
 * OpenAiProvider — real OpenAI implementation of ILlmProvider.
 *
 * - `stream()`: tries primary model → fallback model → emits fixed handoff message.
 * - `chat()`:   non-streaming with up to 2 retries and 500 ms back-off.
 * - Supports AbortSignal (caller) + per-call timeout (from SystemConfig / env).
 * - Captures token-usage from `stream_options: { include_usage: true }`.
 */
@Injectable()
export class OpenAiProvider implements ILlmProvider {
  private readonly logger = new Logger(OpenAiProvider.name);
  private readonly client: OpenAI;
  private readonly defaultModel: string;
  private readonly defaultMaxTokens: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly systemConfigService: SystemConfigService,
  ) {
    this.client = new OpenAI({
      apiKey: this.configService.getOrThrow<string>('LLM_API_KEY'),
      baseURL: this.configService.get<string>('LLM_BASE_URL') ?? undefined,
    });
    this.defaultModel = this.configService.get<string>('LLM_MODEL') ?? PRIMARY_MODEL;
    this.defaultMaxTokens = Number(this.configService.get<string>('LLM_MAX_TOKENS') ?? 1000);
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Non-streaming completion. Retries up to `CHAT_MAX_RETRIES` times on error.
   */
  async chat(request: LlmChatRequest): Promise<LlmChatResponse> {
    const model = request.model ?? this.defaultModel;
    const maxTokens = request.maxTokens ?? this.defaultMaxTokens;
    const temperature = request.temperature ?? 0.7;
    const timeoutMs = this.resolveTimeoutMs();

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= CHAT_MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await this.sleep(CHAT_RETRY_DELAY_MS);
      }

      try {
        const startMs = Date.now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        let response: OpenAI.Chat.Completions.ChatCompletion;
        try {
          response = await this.client.chat.completions.create(
            {
              model,
              messages: request.messages,
              max_completion_tokens: maxTokens,
              temperature,
            },
            { signal: controller.signal },
          );
        } finally {
          clearTimeout(timer);
        }

        const content = response.choices[0]?.message?.content ?? '';
        const usage = response.usage;

        return {
          content,
          promptTokens: usage?.prompt_tokens ?? 0,
          completionTokens: usage?.completion_tokens ?? 0,
          totalTokens: usage?.total_tokens ?? 0,
          durationMs: Date.now() - startMs,
          model: response.model ?? model,
          provider: 'openai',
        };
      } catch (err) {
        lastError = err as Error;
        this.logger.warn(`OpenAI chat attempt ${attempt + 1} failed: ${lastError.message}`);
      }
    }

    throw lastError ?? new Error('OpenAI chat failed after retries');
  }

  /**
   * Streaming completion.
   *
   * Attempt order:
   *  1. `this.defaultModel` (primary — normally `gpt-5.4-mini`)
   *  2. `FALLBACK_MODEL` (`gpt-5.4-nano`)
   *  3. Emit a fixed handoff message and a done-chunk with zero usage.
   *
   * The final done-chunk always includes `modelUsed`, `fallbackTriggered`,
   * and `provider` so that `ChatPipelineService` can record them in the
   * AuditLog without any environment-sniffing.
   */
  async *stream(request: LlmChatRequest, signal?: AbortSignal): AsyncIterable<LlmStreamChunk> {
    const timeoutMs = this.resolveTimeoutMs();
    const primary = request.model ?? this.defaultModel;

    this.logger.log(`OpenAiProvider.stream called with model=${primary}`);

    // ── Attempt primary model ────────────────────────────────────────────
    try {
      yield* this.streamWithModel(request, primary, timeoutMs, signal, false);
      return;
    } catch (primaryErr) {
      this.logger.warn(`Primary model "${primary}" failed: ${(primaryErr as Error).message}`);
    }

    // ── Attempt fallback model ────────────────────────────────────────────
    try {
      yield* this.streamWithModel(request, FALLBACK_MODEL, timeoutMs, signal, true);
      return;
    } catch (fallbackErr) {
      this.logger.warn(
        `Fallback model "${FALLBACK_MODEL}" failed: ${(fallbackErr as Error).message}`,
      );
    }

    // ── Both failed — emit fixed handoff message ──────────────────────────
    this.logger.error('Both primary and fallback models failed; emitting handoff message.');
    yield { token: HANDOFF_MESSAGE, done: false };
    yield {
      token: '',
      done: true,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      modelUsed: FALLBACK_MODEL,
      fallbackTriggered: true,
      provider: 'openai',
    };
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /**
   * Core streaming implementation for a specific model.
   * Combines the caller's AbortSignal with a per-call timeout signal.
   *
   * Throws `LlmTimeoutError` when the timeout controller fires so that the
   * pipeline can distinguish timeout from a user-triggered abort.
   */
  private async *streamWithModel(
    request: LlmChatRequest,
    model: string,
    timeoutMs: number,
    callerSignal: AbortSignal | undefined,
    isFallback: boolean,
  ): AsyncIterable<LlmStreamChunk> {
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), timeoutMs);

    const combinedSignal = callerSignal
      ? AbortSignal.any([callerSignal, timeoutController.signal])
      : timeoutController.signal;

    try {
      const stream = await this.client.chat.completions.create(
        {
          model,
          messages: request.messages,
          max_completion_tokens: request.maxTokens ?? this.defaultMaxTokens,
          temperature: request.temperature ?? 0.7,
          stream: true,
          stream_options: { include_usage: true },
        },
        { signal: combinedSignal },
      );

      let promptTokens = 0;
      let completionTokens = 0;
      let totalTokens = 0;

      for await (const chunk of stream) {
        if (combinedSignal.aborted) {
          break;
        }

        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          yield { token: delta, done: false };
        }

        // usage is included in the final chunk when stream_options.include_usage is true
        if (chunk.usage) {
          promptTokens = chunk.usage.prompt_tokens ?? 0;
          completionTokens = chunk.usage.completion_tokens ?? 0;
          totalTokens = chunk.usage.total_tokens ?? 0;
        }
      }

      yield {
        token: '',
        done: true,
        usage: { promptTokens, completionTokens, totalTokens },
        modelUsed: model,
        fallbackTriggered: isFallback,
        provider: 'openai',
      };
    } catch (err) {
      // Distinguish timeout from caller abort so the pipeline can emit the
      // correct SSE event (timeout vs interrupted).
      if (timeoutController.signal.aborted) {
        throw new LlmTimeoutError(`Model "${model}" timed out after ${timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Resolve the LLM timeout in ms.
   * Prefers the `llm_timeout_ms` SystemConfig key; falls back to the
   * `LLM_TIMEOUT_MS` env var; defaults to 10 000 ms.
   */
  private resolveTimeoutMs(): number {
    const fromConfig = this.systemConfigService.getNumber('llm_timeout_ms');
    if (fromConfig !== null && fromConfig !== undefined && fromConfig > 0) {
      return fromConfig;
    }
    const fromEnv = Number(this.configService.get<string>('LLM_TIMEOUT_MS'));
    return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 10_000;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
