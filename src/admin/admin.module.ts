import { Module } from '@nestjs/common';
import { AdminKnowledgeController } from './knowledge/admin-knowledge.controller';
import { AdminSystemConfigController } from './system-config/admin-system-config.controller';
import { AdminKnowledgeService } from './knowledge/admin-knowledge.service';
import { AdminSystemConfigService } from './system-config/admin-system-config.service';
import { AdminSafetyController } from './safety/safety-admin.controller.js';
import { AdminSafetyService } from './safety/safety-admin.service.js';
import { SafetyModule } from '../safety/safety.module.js';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { KnowledgeCategoryModule } from '../knowledge-category/knowledge-category.module';
import { AdminIntentModule } from './intent/admin-intent.module';
import { AdminGlossaryModule } from './glossary/admin-glossary.module';
import { TicketsAdminModule } from './tickets/tickets-admin.module';
import { ConversationsAdminModule } from './conversations/conversations-admin.module';
import { AuditAdminModule } from './audit/audit-admin.module';
import { FeedbackAdminModule } from './feedback/feedback-admin.module';
import { LeadsAdminModule } from './leads/leads-admin.module';
import { DashboardAdminModule } from './dashboard/dashboard-admin.module';
import { AdminWidgetSettingsModule } from './widget-settings/widget-settings.module';

@Module({
  imports: [
    SafetyModule,
    KnowledgeModule,
    KnowledgeCategoryModule,
    AdminIntentModule,
    AdminGlossaryModule,
    TicketsAdminModule,
    ConversationsAdminModule,
    AuditAdminModule,
    FeedbackAdminModule,
    LeadsAdminModule,
    DashboardAdminModule,
    AdminWidgetSettingsModule,
  ],
  controllers: [AdminKnowledgeController, AdminSystemConfigController, AdminSafetyController],
  providers: [AdminKnowledgeService, AdminSystemConfigService, AdminSafetyService],
})
export class AdminModule {}
