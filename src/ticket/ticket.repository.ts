import { Injectable } from '@nestjs/common';
import { Prisma, Ticket, TicketPriority, TicketStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// ─── Shared Types ─────────────────────────────────────────────────────────────

/** Shape of a single entry in the Ticket.notes JSONB array. */
export interface TicketNote {
  id: number;
  content: string;
  createdAt: string; // ISO-8601 string
  author?: string;
}

/** Ticket row with the (nullable) lead summary columns included. */
export type TicketWithLead = Ticket & {
  lead: {
    id: number;
    name: string;
    email: string;
    company: string | null;
  } | null;
};

/** Ticket row with full relations for the admin detail endpoint. */
export type TicketWithRelations = Ticket & {
  lead: {
    id: number;
    name: string;
    email: string;
    company: string | null;
    phone: string | null;
  } | null;
  conversation: {
    id: number;
    sessionId: string;
    session_token: string;
  };
};

/** Params for the paginated list query. */
export interface TicketListParams {
  status?: TicketStatus;
  priority?: TicketPriority;
  keyword?: string;
  dateFrom?: Date;
  dateTo?: Date;
  skip?: number;
  take?: number;
  sortBy?: 'createdAt' | 'updatedAt' | 'status' | 'priority';
  sortOrder?: 'asc' | 'desc';
}

// ─── Repository ───────────────────────────────────────────────────────────────

/**
 * TicketRepository — data-access layer for the `tickets` table.
 */
@Injectable()
export class TicketRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Create a new Ticket row. */
  async create(data: Prisma.TicketCreateInput): Promise<Ticket> {
    return this.prisma.ticket.create({ data });
  }

  /** Find a Ticket by its primary key (bare row, no relations). */
  async findById(id: number): Promise<Ticket | null> {
    return this.prisma.ticket.findUnique({ where: { id } });
  }

  /** Find a Ticket by primary key, including lead and conversation relations. */
  async findByIdWithRelations(id: number): Promise<TicketWithRelations | null> {
    const row = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
        lead: { select: { id: true, name: true, email: true, company: true, phone: true } },
        conversation: { select: { id: true, sessionId: true, session_token: true } },
      },
    });
    return row as TicketWithRelations | null;
  }

  /** Find the most recent active Ticket for a given conversationId. */
  async findByConversationId(conversationId: number): Promise<Ticket | null> {
    return this.prisma.ticket.findFirst({
      where: { conversationId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Paginated list with optional filters.
   * Returns `items` (with lead relation) and `total` count.
   */
  async list(params: TicketListParams): Promise<{ items: TicketWithLead[]; total: number }> {
    const where = this.buildWhere(params);
    const orderBy = this.buildOrderBy(params);

    const [rows, total] = await Promise.all([
      this.prisma.ticket.findMany({
        where,
        skip: params.skip ?? 0,
        take: params.take ?? 20,
        orderBy,
        include: {
          lead: { select: { id: true, name: true, email: true, company: true } },
        },
      }),
      this.prisma.ticket.count({ where }),
    ]);

    return { items: rows as unknown as TicketWithLead[], total };
  }

  /** Partially update a Ticket. */
  async update(id: number, data: Prisma.TicketUpdateInput): Promise<Ticket> {
    return this.prisma.ticket.update({ where: { id }, data });
  }

  /** Update only the status field (and optionally resolvedAt). */
  async updateStatus(id: number, status: TicketStatus): Promise<Ticket> {
    return this.prisma.ticket.update({ where: { id }, data: { status } });
  }

  /**
   * Append a note to the Ticket.notes JSONB array.
   * Fetches the current row to build the new array, then updates atomically.
   */
  async addNote(id: number, note: TicketNote): Promise<Ticket | null> {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) {
      return null;
    }
    const existing = Array.isArray(ticket.notes)
      ? (ticket.notes as unknown as TicketNote[])
      : [];
    const updated = [...existing, note];
    return this.prisma.ticket.update({
      where: { id },
      data: { notes: updated as unknown as Prisma.InputJsonValue },
    });
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private buildWhere(params: TicketListParams): Prisma.TicketWhereInput {
    const where: Prisma.TicketWhereInput = { deletedAt: null };
    if (params.status) where.status = params.status;
    if (params.priority) where.priority = params.priority;
    if (params.keyword) {
      where.OR = [
        { summary: { contains: params.keyword, mode: 'insensitive' } },
        { triggerReason: { contains: params.keyword, mode: 'insensitive' } },
      ];
    }
    if (params.dateFrom !== undefined || params.dateTo !== undefined) {
      where.createdAt = {
        ...(params.dateFrom ? { gte: params.dateFrom } : {}),
        ...(params.dateTo ? { lte: params.dateTo } : {}),
      };
    }
    return where;
  }

  private buildOrderBy(params: TicketListParams): Prisma.TicketOrderByWithRelationInput {
    const field = params.sortBy ?? 'createdAt';
    const order = params.sortOrder ?? 'desc';
    return { [field]: order };
  }
}
