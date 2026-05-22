import { Injectable } from '@nestjs/common';
import { Ticket, TicketPriority, TicketStatus } from '../../generated/prisma/client';
import { TicketNote, TicketWithLead, TicketWithRelations } from '../../ticket/ticket.repository';
import { TicketService } from '../../ticket/ticket.service';
import { ListTicketsQueryDto } from './dto/ticket-admin.dto';

// ─── View Models ──────────────────────────────────────────────────────────────

export interface TicketNoteVm {
  id: number;
  content: string;
  createdAt: string;
  author?: string;
}

export interface TicketVm {
  id: number;
  title: string;
  summary: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  triggerReason: string;
  assignee: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  leadId: number | null;
  conversationId: number;
  notes: TicketNoteVm[];
  lead?: { id: number; name: string; email: string; company: string | null } | null;
}

export interface TimelineEventVm {
  event: string;
  at: string;
  content?: string;
}

export interface TicketDetailVm extends TicketVm {
  conversation: { id: number; sessionId: string; sessionToken: string } | null;
  timeline: TimelineEventVm[];
}

export interface TicketListResult {
  data: TicketVm[];
  meta: { total: number; page: number; pageSize: number };
}

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * TicketsAdminService — transforms Ticket domain objects into admin ViewModels.
 *
 * All business logic (status validation, note appending, resolvedAt management)
 * is handled by TicketService. This service is responsible for:
 *  - Parsing and forwarding query parameters
 *  - Transforming rows into TicketVm / TicketDetailVm
 *  - Generating the simplified timeline
 */
@Injectable()
export class TicketsAdminService {
  constructor(private readonly ticketService: TicketService) {}

  // ── List ──────────────────────────────────────────────────────────────────

  /** Return a paginated list of tickets with optional filters. */
  async list(query: ListTicketsQueryDto): Promise<TicketListResult> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const { items, total } = await this.ticketService.list({
      status: query.status as TicketStatus | undefined,
      priority: query.priority as TicketPriority | undefined,
      keyword: query.keyword,
      dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
      dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
      skip: (page - 1) * pageSize,
      take: pageSize,
      sortBy: query.sortBy as 'createdAt' | 'updatedAt' | 'status' | 'priority' | undefined,
      sortOrder: query.sortOrder as 'asc' | 'desc' | undefined,
    });

    return {
      data: items.map((t) => this.toVm(t)),
      meta: { total, page, pageSize },
    };
  }

  // ── Detail ────────────────────────────────────────────────────────────────

  /** Return a single ticket with full relations and a simplified timeline. */
  async findOne(id: number): Promise<TicketDetailVm> {
    const ticket = await this.ticketService.findByIdWithRelations(id);
    return this.toDetailVm(ticket);
  }

  // ── Status update ─────────────────────────────────────────────────────────

  /** Update ticket status; enforces four-state lifecycle in TicketService. */
  async updateStatus(id: number, status: string): Promise<TicketVm> {
    const updated = await this.ticketService.updateTicketStatus(id, status);
    return this.toVm(updated as TicketWithLead);
  }

  // ── Notes ─────────────────────────────────────────────────────────────────

  /** Append a note to the ticket. Returns the updated ticket (including notes). */
  async addNote(id: number, content: string): Promise<TicketVm> {
    const updated = await this.ticketService.addTicketNote(id, content);
    return this.toVm(updated as TicketWithLead);
  }

  // ── View Model transformers ───────────────────────────────────────────────

  private toVm(ticket: Ticket & Partial<Pick<TicketWithLead, 'lead'>>): TicketVm {
    const notes = this.parseNotes(ticket.notes);
    const title = ticket.summary?.trim()
      ? ticket.summary
      : ticket.triggerReason
        ? ticket.triggerReason
        : `Ticket #${ticket.id}`;
    return {
      id: ticket.id,
      title,
      summary: ticket.summary,
      status: ticket.status,
      priority: ticket.priority,
      triggerReason: ticket.triggerReason,
      assignee: ticket.assignee,
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
      resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
      leadId: ticket.leadId,
      conversationId: ticket.conversationId,
      notes,
      lead: ticket.lead ?? null,
    };
  }

  private toDetailVm(ticket: TicketWithRelations): TicketDetailVm {
    const base = this.toVm(ticket);
    return {
      ...base,
      lead: ticket.lead,
      conversation: ticket.conversation
        ? {
            id: ticket.conversation.id,
            sessionId: ticket.conversation.sessionId,
            sessionToken: ticket.conversation.session_token,
          }
        : null,
      timeline: this.buildTimeline(ticket),
    };
  }

  private parseNotes(raw: unknown): TicketNoteVm[] {
    if (!Array.isArray(raw)) return [];
    return (raw as TicketNote[]).map((n) => ({
      id: n.id,
      content: n.content,
      createdAt: n.createdAt,
      ...(n.author !== undefined ? { author: n.author } : {}),
    }));
  }

  /**
   * Build a simplified timeline from available data.
   * In the absence of a status-history table, events are derived from:
   *   - ticket.createdAt (ticket_created)
   *   - notes entries (note_added)
   *   - ticket.resolvedAt (resolved)
   *   - ticket.updatedAt (last_updated) — only when different from createdAt
   */
  private buildTimeline(ticket: TicketWithRelations): TimelineEventVm[] {
    const events: TimelineEventVm[] = [];

    events.push({ event: 'ticket_created', at: ticket.createdAt.toISOString() });

    const notes = this.parseNotes(ticket.notes);
    for (const note of notes) {
      events.push({ event: 'note_added', at: note.createdAt, content: note.content });
    }

    if (ticket.resolvedAt) {
      events.push({ event: 'resolved', at: ticket.resolvedAt.toISOString() });
    }

    if (ticket.updatedAt.getTime() !== ticket.createdAt.getTime()) {
      events.push({ event: 'last_updated', at: ticket.updatedAt.toISOString() });
    }

    // Sort chronologically
    events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

    return events;
  }
}
