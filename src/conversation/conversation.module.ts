import { Module } from '@nestjs/common';
import { ConversationRepository } from './conversation.repository';
import { ConversationService } from './conversation.service';

/**
 * ConversationModule — manages chat sessions, messages, and session-token mapping.
 *
 * Exports `ConversationService` so that ChatModule (and other Phase 2+ modules)
 * can create sessions and append messages without coupling directly to Prisma.
 */
@Module({
  providers: [ConversationRepository, ConversationService],
  exports: [ConversationService],
})
export class ConversationModule {}
