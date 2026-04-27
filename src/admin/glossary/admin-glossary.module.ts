import { Module } from '@nestjs/common';
import { IntentModule } from '../../intent/intent.module';
import { AdminGlossaryController } from './admin-glossary.controller';
import { AdminGlossaryService } from './admin-glossary.service';

/**
 * AdminGlossaryModule — exposes admin CRUD endpoints for glossary terms.
 *
 * Imports IntentModule to access IntentService.invalidateCache() so that
 * any mutation is immediately reflected in the in-memory synonym-expansion cache.
 */
@Module({
  imports: [IntentModule],
  controllers: [AdminGlossaryController],
  providers: [AdminGlossaryService],
})
export class AdminGlossaryModule {}
