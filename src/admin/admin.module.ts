import { Module } from '@nestjs/common';
import { AdminKnowledgeController } from './knowledge/admin-knowledge.controller';
import { AdminSystemConfigController } from './system-config/admin-system-config.controller';
import { AdminKnowledgeService } from './knowledge/admin-knowledge.service';
import { AdminSystemConfigService } from './system-config/admin-system-config.service';
import { AdminSafetyController } from './safety/safety-admin.controller.js';
import { AdminSafetyService } from './safety/safety-admin.service.js';
import { SafetyModule } from '../safety/safety.module.js';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { AdminIntentModule } from './intent/admin-intent.module';
import { AdminGlossaryModule } from './glossary/admin-glossary.module';

/**
 * AdminModule — aggregates all admin-facing route controllers.
 *
 * Phase 1 status: SystemConfig controller returns 501.
 * Phase 3 (T3-006): Safety admin CRUD is fully implemented.
 * Knowledge admin CRUD is fully implemented (create/update support language + aliases).
 * 002 IG-002/IG-003: Intent and Glossary admin modules wired in.
 */
@Module({
  imports: [SafetyModule, KnowledgeModule, AdminIntentModule, AdminGlossaryModule],
  controllers: [
    AdminKnowledgeController,
    AdminSystemConfigController,
    AdminSafetyController,
  ],
  providers: [AdminKnowledgeService, AdminSystemConfigService, AdminSafetyService],
})
export class AdminModule {}
