import { Module } from '@nestjs/common';
import { ConversationModule } from '../conversation/conversation.module';
import { DiagnosisService } from './diagnosis.service';

/**
 * DiagnosisModule — provides the product-diagnosis state machine.
 *
 * Imports `ConversationModule` so `DiagnosisService` can read/write
 * `Conversation.diagnosisContext` without touching Prisma directly.
 *
 * Exports `DiagnosisService` for Phase 4 Chat Pipeline integration.
 */
@Module({
  imports: [ConversationModule],
  providers: [DiagnosisService],
  exports: [DiagnosisService],
})
export class DiagnosisModule {}
