import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Ticket, TicketPriority, TicketStatus } from '../generated/prisma/client';
import { TicketListParams, TicketNote, TicketWithLead, TicketWithRelations } from './ticket.repository';
import { TicketRepository } from './ticket.repository';
import { AuditService } from '../audit/audit.service';

// Valid four-state lifecycle values (matches DB enum).
const VALID_STATUSES: TicketStatus[] = ['open', 'in_progress', 'resolved', 'closed'];

/**
 * TicketService — domain logic for the Ticket lifecycle.
 *
 * Status policy (resolved revert):
 *   Reverting from `resolved` back to `open` or `in_progress` IS allowed.
 *   `resolvedAt` is cleared when the status is reverted.
 *   Once `closed`, the ticket cannot be re-opened (400).
 */
@Injectable()
export class TicketService {
  constructor(
    private readonly ticketRepository: TicketRepository,
    private readonly auditService: AuditService,
  ) {}

  // ── Creation ──────────────────────────────────────────────────────────────

  /** Create a new Ticket (used internally and by admin). */
  async createTicket(data: Prisma.TicketCreateInput): Promise<Ticket> {
    return this.ticketRepository.create(data);
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  /** Find a ticket by ID (bare row). Throws 404 if not found. */
  async findById(id: number): Promise<Ticket> {
    const ticket = await this.ticketRepository.findById(id);
    if (!ticket) {
      throw new NotFoundException(`Ticket ${id} not found`);
    }
    return ticket;
  }

  /** Find a ticket with lead + conversation relations. Throws 404 if not found. */
  async findByIdWithRelations(id: number): Promise<TicketWithRelations> {
    const ticket = await this.ticketRepository.findByIdWithRelations(id);
    if (!ticket) {
      throw new NotFoundException(`Ticket ${id} not found`);
    }
    return ticket;
  }

  /**
   * Paginated list of tickets with optional filters.
   * Returns `{ items, total }` — caller computes page/pageSize meta.
   */
  async list(params: TicketListParams): Promise<{ items: TicketWithLead[]; total: number }> {
    return this.ticketRepository.list(params);
  }

  // ── Status update ─────────────────────────────────────────────────────────

  /**
   * Update the ticket status, enforcing the four-state lifecycle rules.
   *
   * Rules:
   *  - `status` must be one of: open | in_progress | resolved | closed (else 400)
   *  - Setting `resolved` sets `resolvedAt = now()` if not already set
   *  - Reverting from `resolved` → `open` | `in_progress` clears `resolvedAt`
   *  - Transitioning from `closed` is forbidden (400)
   */
  async updateTicketStatus(id: number, status: string): Promise<Ticket> {
    const validatedStatus = this.validateTicketStatus(status);
    const ticket = await this.ticketRepository.findById(id);
    if (!ticket) {
      throw new NotFoundException(`Ticket ${id} not found`);
    }

    if (ticket.status === 'closed' && validatedStatus !== 'closed') {
      throw new BadRequestException('A closed ticket cannot be re-opened');
    }

    const fromStatus = ticket.status;
    const data: Prisma.TicketUpdateInput = { status: validatedStatus };

    if (validatedStatus === 'resolved' && !ticket.resolvedAt) {
      data.resolvedAt = new Date();
    } else if (
      (validatedStatus === 'open' || validatedStatus === 'in_progress') &&
      ticket.resolvedAt !== null
    ) {
      // Revert from resolved — clear resolvedAt
      data.resolvedAt = null;
    }

    const updated = await this.ticketRepository.update(id, data);

    void this.auditService.log({
      eventType: 'ticket_status_changed',
      eventData: {
        ticketId: id,
        fromStatus,
        toStatus: validatedStatus,
        resolvedAt: updated.resolvedAt?.toISOString() ?? null,
      },
    }).catch(() => undefined);

    return updated;
  }

  // ── Notes ─────────────────────────────────────────────────────────────────

  /**
   * Append a note to the ticket's JSONB notes array.
   * `content` must be non-blank (enforced at DTO level; guarded here too).
   */
  async addTicketNote(id: number, content: string): Promise<Ticket> {
    const trimmed = content.trim();
    if (!trimmed) {
      throw new BadRequestException('Note content must not be blank');
    }

    const ticket = await this.ticketRepository.findById(id);
    if (!ticket) {
      throw new NotFoundException(`Ticket ${id} not found`);
    }

    const existing = Array.isArray(ticket.notes)
      ? (ticket.notes as unknown as TicketNote[])
      : [];

    const note: TicketNote = {
      id: existing.length + 1,
      content: trimmed,
      createdAt: new Date().toISOString(),
    };

    const updated = await this.ticketRepository.addNote(id, note);
    if (!updated) {
      throw new NotFoundException(`Ticket ${id} not found`);
    }

    void this.auditService.log({
      eventType: 'ticket_note_added',
      eventData: { ticketId: id, noteId: note.id },
    }).catch(() => undefined);

    return updated;
  }

  // ── Validation ────────────────────────────────────────────────────────────

  /**
   * Validate a raw status string against the allowed enum values.
   * Throws BadRequestException (400) if invalid.
   */
  validateTicketStatus(status: string): TicketStatus {
    if (!VALID_STATUSES.includes(status as TicketStatus)) {
      throw new BadRequestException(
        `Invalid status "${status}". Allowed values: ${VALID_STATUSES.join(', ')}`,
      );
    }
    return status as TicketStatus;
  }

  // ── Priority validation (optional helper) ─────────────────────────────────

  /** Validate a raw priority string. Throws 400 if invalid. */
  validateTicketPriority(priority: string): TicketPriority {
    const valid: TicketPriority[] = ['low', 'medium', 'high'];
    if (!valid.includes(priority as TicketPriority)) {
      throw new BadRequestException(
        `Invalid priority "${priority}". Allowed values: ${valid.join(', ')}`,
      );
    }
    return priority as TicketPriority;
  }
}
