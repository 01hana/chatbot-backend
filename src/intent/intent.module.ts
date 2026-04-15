import { Module } from '@nestjs/common';
import { IntentRepository } from './intent.repository';
import { IntentService } from './intent.service';

/**
 * IntentModule — provides intent-detection and glossary-lookup capabilities.
 *
 * Exports `IntentService` so that ChatModule (Phase 2) can inject it into
 * the chat pipeline without importing PrismaModule directly.
 */
@Module({
  providers: [IntentRepository, IntentService],
  exports: [IntentService],
})
export class IntentModule {}
