import { Module } from '@nestjs/common';
import { SafetyRepository } from './safety.repository';
import { SafetyService } from './safety.service';

/**
 * SafetyModule — provides prompt-guard and confidentiality-check capabilities.
 *
 * Exports `SafetyService` so that other modules (e.g. ChatModule in Phase 2)
 * can inject it into the chat pipeline without importing PrismaModule directly.
 */
@Module({
  providers: [SafetyRepository, SafetyService],
  exports: [SafetyService],
})
export class SafetyModule {}
