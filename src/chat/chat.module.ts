import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatPipelineService } from './chat-pipeline.service';
import { PromptBuilder } from './prompt-builder';
import { ConversationModule } from '../conversation/conversation.module';
import { LlmModule } from '../llm/llm.module';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { SafetyModule } from '../safety/safety.module';
import { IntentModule } from '../intent/intent.module';
import { HealthModule } from '../health/health.module';
import { QueryAnalysisModule } from '../query-analysis/query-analysis.module';

/**
 * ChatModule — wires together the complete chat pipeline and HTTP endpoints.
 *
 * Imports:
 *  - ConversationModule    → session + message persistence
 *  - LlmModule             → ILlmProvider DI token (MockLlmProvider in Phase 2)
 *  - RetrievalModule       → RETRIEVAL_SERVICE DI token
 *  - SafetyModule          → prompt guard + confidentiality check
 *  - IntentModule          → intent detection
 *  - HealthModule          → AiStatusService (degraded tracking)
 *  - QueryAnalysisModule   → QueryAnalysisService (QA-005; feature-flag-guarded)
 *
 * AuditModule is @Global, so AuditService is available without explicit import.
 * SystemConfigModule is @Global, so SystemConfigService is available too.
 * PrismaModule is @Global, so PrismaService is available too.
 */
@Module({
  imports: [
    ConversationModule,
    LlmModule,
    RetrievalModule,
    SafetyModule,
    IntentModule,
    HealthModule,
    QueryAnalysisModule,
  ],
  controllers: [ChatController],
  providers: [ChatPipelineService, PromptBuilder],
})
export class ChatModule {}
