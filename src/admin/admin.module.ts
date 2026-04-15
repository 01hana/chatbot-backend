import { Module } from '@nestjs/common';
import { AdminKnowledgeController } from './knowledge/admin-knowledge.controller';
import { AdminSystemConfigController } from './system-config/admin-system-config.controller';
import { AdminKnowledgeService } from './knowledge/admin-knowledge.service';
import { AdminSystemConfigService } from './system-config/admin-system-config.service';

/**
 * AdminModule — aggregates all admin-facing route controllers.
 *
 * Phase 1 status: Controllers register correct route paths but return 501.
 * Phase 6 will import KnowledgeModule and SystemConfigModule here and wire
 * the service dependencies into the controllers.
 */
@Module({
  controllers: [AdminKnowledgeController, AdminSystemConfigController],
  providers: [AdminKnowledgeService, AdminSystemConfigService],
})
export class AdminModule {}
