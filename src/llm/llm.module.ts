import { Module } from '@nestjs/common';
import { MockLlmProvider } from './providers/mock-llm.provider';
import { OpenAiProvider } from './providers/openai.provider';
import { LLM_PROVIDER } from './interfaces/llm-provider.interface';

/**
 * LlmModule — provides the ILlmProvider DI binding.
 *
 * - In `test` environment (`NODE_ENV === 'test'`): binds `LLM_PROVIDER` to
 *   `MockLlmProvider` so that unit/integration tests never call the real API.
 * - In all other environments: binds `LLM_PROVIDER` to `OpenAiProvider`.
 *
 * `MockLlmProvider` is always exported so test modules can inject it directly
 * when they need to control stream behaviour.
 */
const isTest = process.env.NODE_ENV === 'test';

@Module({
  providers: [
    MockLlmProvider,
    OpenAiProvider,
    {
      provide: LLM_PROVIDER,
      useExisting: isTest ? MockLlmProvider : OpenAiProvider,
    },
  ],
  exports: [LLM_PROVIDER, MockLlmProvider],
})
export class LlmModule {}
