import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AddTicketNoteDto, ListTicketsQueryDto, UpdateTicketStatusDto } from './dto/ticket-admin.dto';
import { TicketDetailVm, TicketListResult, TicketVm, TicketsAdminService } from './tickets-admin.service';

/**
 * TicketsAdminController — admin CRUD for Tickets.
 *
 * Routes (all under /api/v1/):
 *  GET    admin/tickets                   → paginated list with filters
 *  GET    admin/tickets/:id               → ticket detail with timeline
 *  PATCH  admin/tickets/:id/status        → update ticket status (four-state)
 *  POST   admin/tickets/:id/notes         → append a note to the ticket
 *
 * Auth / RBAC: deferred per spec.md.
 */
@Controller('admin/tickets')
export class TicketsAdminController {
  constructor(private readonly ticketsAdminService: TicketsAdminService) {}

  /**
   * GET /api/v1/admin/tickets
   *
   * Query params (all optional):
   *   page, pageSize, keyword, status, priority, dateFrom, dateTo, sortBy, sortOrder
   *
   * Response: { data: TicketVm[], meta: { total, page, pageSize } }
   */
  @Get()
  async list(@Query() query: ListTicketsQueryDto): Promise<TicketListResult> {
    return this.ticketsAdminService.list(query);
  }

  /**
   * GET /api/v1/admin/tickets/:id
   *
   * Returns the full ticket detail including:
   *  - All TicketVm fields
   *  - Lead summary (if linked)
   *  - Conversation reference (sessionToken)
   *  - Simplified timeline
   */
  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<TicketDetailVm> {
    return this.ticketsAdminService.findOne(id);
  }

  /**
   * PATCH /api/v1/admin/tickets/:id/status
   *
   * Body: { status: "open" | "in_progress" | "resolved" | "closed" }
   *
   * Rules:
   *  - Invalid status → 400
   *  - Ticket not found → 404
   *  - Closed ticket re-opened → 400
   *  - Setting resolved → sets resolvedAt
   *  - Reverting from resolved → clears resolvedAt
   */
  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  async updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTicketStatusDto,
  ): Promise<TicketVm> {
    return this.ticketsAdminService.updateStatus(id, dto.status);
  }

  /**
   * POST /api/v1/admin/tickets/:id/notes
   *
   * Body: { content: string }
   *
   * Appends a note to the ticket's JSONB notes array.
   *  - Ticket not found → 404
   *  - Empty/blank content → 400
   */
  @Post(':id/notes')
  @HttpCode(HttpStatus.CREATED)
  async addNote(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddTicketNoteDto,
  ): Promise<TicketVm> {
    return this.ticketsAdminService.addNote(id, dto.content);
  }
}
