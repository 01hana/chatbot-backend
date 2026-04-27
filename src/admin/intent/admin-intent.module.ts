import { Module } from '@nestjs/common';
import { IntentModule } from '../../intent/intent.module';
import { AdminIntentController } from './admin-intent.controller';
import { AdminIntentService } from './admin-intent.service';

/**
 * AdminIntentModule — exposes admin CRUD endpoints for intent templates.
 *
 * Imports IntentModule to access IntentService.invalidateCache() so that
 * any mutation is immediately reflected in the in-memory detection cache.
 */
@Module({
  imports: [IntentModule],
  controllers: [AdminIntentController],
  providers: [AdminIntentService],
})
export class AdminIntentModule {}
