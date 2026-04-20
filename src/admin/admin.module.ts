import { Module } from '@nestjs/common';
import { AdminKnowledgeController } from './knowledge/admin-knowledge.controller';
import { AdminSystemConfigController } from './system-config/admin-system-config.controller';
import { AdminKnowledgeService } from './knowledge/admin-knowledge.service';
import { AdminSystemConfigService } from './system-config/admin-system-config.service';
import { AdminSafetyController } from './safety/safety-admin.controller.js';
import { AdminSafetyService } from './safety/safety-admin.service.js';
import { SafetyModule } from '../safety/safety.module.js';

/**
 * AdminModule — aggregates all admin-facing route controllers.
 *
 * Phase 1 status: Knowledge and SystemConfig controllers return 501.
 * Phase 3 (T3-006): Safety admin CRUD is fully implemented.
 * Phase 6 will import KnowledgeModule and SystemConfigModule here and wire
 * the remaining service dependencies.
 */
@Module({
  imports: [SafetyModule],
  controllers: [
    AdminKnowledgeController,
    AdminSystemConfigController,
    AdminSafetyController,
  ],
  providers: [AdminKnowledgeService, AdminSystemConfigService, AdminSafetyService],
})
export class AdminModule {}
