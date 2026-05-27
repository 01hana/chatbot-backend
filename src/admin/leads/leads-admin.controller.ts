import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ListLeadsQueryDto } from './dto/list-leads-query.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';
import {
  LeadDetailVm,
  LeadListResult,
  LeadVm,
  LeadsAdminService,
  NotificationListResult,
} from './leads-admin.service';

/**
 * LeadsAdminController — admin API for Lead data.
 *
 * Routes (all under /api/v1/):
 *  GET   admin/leads                      → paginated list with filters
 *  GET   admin/leads/:id                  → lead detail with conversation + ticket
 *  PATCH admin/leads/:id                  → partial update (status, note, fields)
 *  PATCH admin/leads/:id/status           → status-only update
 *  GET   admin/leads/:id/notifications    → notification delivery history (deferred)
 *
 * Auth / RBAC: deferred per spec.md.
 */
@Controller('admin/leads')
export class LeadsAdminController {
  constructor(private readonly leadsAdminService: LeadsAdminService) {}

  /**
   * GET /api/v1/admin/leads
   *
   * Supported query params (all optional):
   *   page, pageSize, keyword, status, notificationStatus, type,
   *   dateFrom, dateTo, sortBy, sortOrder
   */
  @Get()
  async list(@Query() query: ListLeadsQueryDto): Promise<LeadListResult> {
    return this.leadsAdminService.list(query);
  }

  /**
   * GET /api/v1/admin/leads/:id
   *
   * Returns full LeadDetailVm including:
   *  - All lead fields
   *  - conversationSummary (id, sessionId, sessionToken, status, messageCount)
   *  - relatedTicket (if any)
   *  - timeline (simplified: lead_created, status_changed, notes_updated)
   */
  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<LeadDetailVm> {
    return this.leadsAdminService.findOne(id);
  }

  /**
   * PATCH /api/v1/admin/leads/:id
   *
   * Partial update. Accepted fields: status, note, company, phone, message.
   * - `note` is appended (newline-delimited) to the existing notes field.
   * - Status change is audit-logged as lead_status_changed.
   */
  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLeadDto,
  ): Promise<LeadVm> {
    return this.leadsAdminService.update(id, dto);
  }

  /**
   * PATCH /api/v1/admin/leads/:id/status
   *
   * Dedicated status-update endpoint. Accepts { status: LeadStatus }.
   * Returns 400 when status value is invalid.
   */
  @Patch(':id/status')
  async updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLeadStatusDto,
  ): Promise<LeadVm> {
    return this.leadsAdminService.updateStatus(id, dto);
  }

  /**
   * GET /api/v1/admin/leads/:id/notifications
   *
   * NOTE: NotificationJob / NotificationDelivery is deferred to a later
   * notification slice. Returns an empty compatible response for now.
   */
  @Get(':id/notifications')
  async getNotifications(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<NotificationListResult> {
    return this.leadsAdminService.getNotifications(id);
  }
}
