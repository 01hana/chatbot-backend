import { Module } from '@nestjs/common';
import { MockLlmProvider } from './providers/mock-llm.provider';
import { LLM_PROVIDER } from './interfaces/llm-provider.interface';

/**
 * LlmModule — provides the ILlmProvider DI binding.
 *
 * Phase 2 (pre-T2-004): binds `LLM_PROVIDER` to `MockLlmProvider`.
 * Once T2-004 is implemented, replace `MockLlmProvider` with `OpenAiProvider`
 * and bind using the same `LLM_PROVIDER` token — no other code needs changing.
 *
 * Exports the token so that ChatModule and any future consumer can inject the
 * provider without depending on a concrete class.
 */
@Module({
  providers: [
    MockLlmProvider,
    {
      provide: LLM_PROVIDER,
      useExisting: MockLlmProvider,
    },
  ],
  exports: [LLM_PROVIDER],
})
export class LlmModule {}
