import { Module } from '@nestjs/common';
import { DashboardAdminController } from './dashboard-admin.controller';
import { DashboardAdminService } from './dashboard-admin.service';

/**
 * DashboardAdminModule — provides GET /api/v1/admin/dashboard.
 *
 * PrismaModule is @Global — no explicit import needed.
 * FeedbackService is no longer used by this module.
 */
@Module({
  controllers: [DashboardAdminController],
  providers: [DashboardAdminService],
})
export class DashboardAdminModule {}
