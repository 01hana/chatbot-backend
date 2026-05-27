import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import {
  AuditAdminService,
  AuditLogDetailVm,
  AuditLogListResult,
} from './audit-admin.service';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';

/**
 * AuditAdminController — admin read endpoints for audit logs.
 *
 * Routes (all under /api/v1 global prefix):
 *   GET  /admin/audit-logs       → paginated list with filters
 *   GET  /admin/audit-logs/:id   → full audit event detail
 */
@Controller('admin/audit-logs')
export class AuditAdminController {
  constructor(private readonly service: AuditAdminService) {}

  /** GET /api/v1/admin/audit-logs */
  @Get()
  list(@Query() query: ListAuditLogsQueryDto): Promise<AuditLogListResult> {
    return this.service.list(query);
  }

  /** GET /api/v1/admin/audit-logs/:id */
  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AuditLogDetailVm> {
    return this.service.findOne(id);
  }
}
