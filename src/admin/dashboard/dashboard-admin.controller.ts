import { Controller, Get, Query } from '@nestjs/common';
import { DashboardAdminService } from './dashboard-admin.service';
import { DashboardQueryDto } from './dto/dashboard-query.dto';
import { DashboardStats } from './types/dashboard-stats.type';

/**
 * DashboardAdminController — serves GET /api/v1/admin/dashboard.
 *
 * The global TransformInterceptor wraps the return value in:
 *   { data: DashboardStats, code: number, requestId: string }
 *
 * No query params are required.
 * Optional: ?month=YYYY-MM to query a specific month (400 on bad format).
 */
@Controller('admin/dashboard')
export class DashboardAdminController {
  constructor(private readonly dashboardAdminService: DashboardAdminService) {}

  /**
   * GET /api/v1/admin/dashboard
   * GET /api/v1/admin/dashboard?month=2026-01
   *
   * Omitting month defaults to the current calendar month.
   * 400 is returned when month is present but does not match YYYY-MM.
   */
  @Get()
  async getStats(@Query() query: DashboardQueryDto): Promise<DashboardStats> {
    return this.dashboardAdminService.getStats(query.month);
  }
}
