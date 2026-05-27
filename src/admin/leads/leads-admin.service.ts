import { Injectable, NotFoundException } from '@nestjs/common';
import { Lead, LeadStatus, Prisma, TicketStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { ListLeadsQueryDto } from './dto/list-leads-query.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';

// ─── View Models ──────────────────────────────────────────────────────────────

export interface LeadVm {
  id: number;
  conversationId: number;
  name: string;
  email: string;
  company: string | null;
  phone: string | null;
  message: string | null;
  language: string | null;
  type: string;
  riskLevel: string | null;
  confidentialityTriggered: boolean;
  promptInjectionDetected: boolean;
  sensitiveIntentCount: number;
  highIntentScore: number;
  notificationStatus: string | null;
  status: LeadStatus;
  notes: string | null;
  sessionToken: string | null;
  ticketId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationSummaryInLead {
  id: number;
  sessionId: string;
  sessionToken: string;
  status: string;
  messageCount: number;
}

export interface RelatedTicketVm {
  id: number;
  status: TicketStatus;
  priority: string;
  triggerReason: string;
  createdAt: string;
}

export interface LeadTimelineEvent {
  event: string;
  at: string;
  content?: string;
}

export interface LeadDetailVm extends LeadVm {
  conversationSummary: ConversationSummaryInLead | null;
  relatedTicket: RelatedTicketVm | null;
  timeline: LeadTimelineEvent[];
}

export interface LeadListResult {
  data: LeadVm[];
  meta: { total: number; page: number; pageSize: number };
}

export interface NotificationListResult {
  data: never[];
  meta: { total: number; page: number; pageSize: number };
}

// ─── Row type aliases ─────────────────────────────────────────────────────────

type LeadRow = Lead & {
  conversation: { session_token: string; sessionId: string; status: string } | null;
  tickets: { id: number; status: TicketStatus }[];
};

type LeadDetailRow = Lead & {
  conversation: {
    id: number;
    sessionId: string;
    session_token: string;
    status: string;
    _count: { messages: number };
  } | null;
  tickets: {
    id: number;
    status: TicketStatus;
    priority: string;
    triggerReason: string;
    createdAt: Date;
  }[];
};

// ─── Service ─────────────────────────────────────────────────────────────────

/**
 * LeadsAdminService — admin-facing queries and updates for Lead data.
 *
 * Uses PrismaService directly for complex join queries.
 * AuditService is injected for fire-and-forget audit logging.
 */
@Injectable()
export class LeadsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  // ── List ──────────────────────────────────────────────────────────────────

  async list(query: ListLeadsQueryDto): Promise<LeadListResult> {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = (query.sortOrder ?? 'desc') as 'asc' | 'desc';

    const andConditions: Prisma.LeadWhereInput[] = [{ deletedAt: null }];

    if (query.keyword) {
      andConditions.push({
        OR: [
          { name: { contains: query.keyword, mode: 'insensitive' } },
          { email: { contains: query.keyword, mode: 'insensitive' } },
          { company: { contains: query.keyword, mode: 'insensitive' } },
          { message: { contains: query.keyword, mode: 'insensitive' } },
        ],
      });
    }

    if (query.status) {
      andConditions.push({ status: query.status as LeadStatus });
    }

    if (query.notificationStatus) {
      andConditions.push({ notificationStatus: query.notificationStatus });
    }

    if (query.type) {
      andConditions.push({ type: query.type });
    }

    if (query.dateFrom !== undefined || query.dateTo !== undefined) {
      andConditions.push({
        createdAt: {
          ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
          ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
        },
      });
    }

    const where: Prisma.LeadWhereInput =
      andConditions.length === 1 ? andConditions[0] : { AND: andConditions };

    const [rows, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        include: {
          conversation: {
            select: { session_token: true, sessionId: true, status: true },
          },
          tickets: {
            select: { id: true, status: true },
            take: 1,
            orderBy: { createdAt: 'asc' },
          },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { [sortBy]: sortOrder },
      }) as unknown as Promise<LeadRow[]>,
      this.prisma.lead.count({ where }),
    ]);

    return {
      data: rows.map((r) => this.toVm(r)),
      meta: { total, page, pageSize },
    };
  }

  // ── Detail ────────────────────────────────────────────────────────────────

  async findOne(id: number): Promise<LeadDetailVm> {
    const row = (await this.prisma.lead.findUnique({
      where: { id },
      include: {
        conversation: {
          select: {
            id: true,
            sessionId: true,
            session_token: true,
            status: true,
            _count: { select: { messages: true } },
          },
        },
        tickets: {
          select: {
            id: true,
            status: true,
            priority: true,
            triggerReason: true,
            createdAt: true,
          },
          take: 1,
          orderBy: { createdAt: 'asc' },
        },
      },
    })) as unknown as LeadDetailRow | null;

    if (!row) throw new NotFoundException(`Lead ${id} not found`);

    const conversationSummary: ConversationSummaryInLead | null = row.conversation
      ? {
          id: row.conversation.id,
          sessionId: row.conversation.sessionId,
          sessionToken: row.conversation.session_token,
          status: row.conversation.status,
          messageCount: row.conversation._count.messages,
        }
      : null;

    const relatedTicket: RelatedTicketVm | null =
      row.tickets.length > 0
        ? {
            id: row.tickets[0].id,
            status: row.tickets[0].status,
            priority: row.tickets[0].priority,
            triggerReason: row.tickets[0].triggerReason,
            createdAt: row.tickets[0].createdAt.toISOString(),
          }
        : null;

    const timeline = this.buildTimeline(row);

    return {
      ...this.toVm({
        ...row,
        conversation: row.conversation
          ? {
              session_token: row.conversation.session_token,
              sessionId: row.conversation.sessionId,
              status: row.conversation.status,
            }
          : null,
        tickets: row.tickets.map((t) => ({ id: t.id, status: t.status })),
      }),
      conversationSummary,
      relatedTicket,
      timeline,
    };
  }

  // ── Update (PATCH /:id) ───────────────────────────────────────────────────

  async update(id: number, dto: UpdateLeadDto): Promise<LeadVm> {
    const existing = await this.prisma.lead.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Lead ${id} not found`);

    const fromStatus = existing.status;
    const updateData: Prisma.LeadUpdateInput = {};

    if (dto.status !== undefined) updateData.status = dto.status as LeadStatus;
    if (dto.company !== undefined) updateData.company = dto.company;
    if (dto.phone !== undefined) updateData.phone = dto.phone;
    if (dto.message !== undefined) updateData.message = dto.message;

    if (dto.note !== undefined) {
      const trimmedNote = dto.note.trim();
      if (trimmedNote) {
        const merged = existing.notes ? `${existing.notes}\n${trimmedNote}` : trimmedNote;
        updateData.notes = merged;
      }
    }

    const updated = (await this.prisma.lead.update({
      where: { id },
      data: updateData,
      include: {
        conversation: {
          select: { session_token: true, sessionId: true, status: true },
        },
        tickets: {
          select: { id: true, status: true },
          take: 1,
          orderBy: { createdAt: 'asc' },
        },
      },
    })) as unknown as LeadRow;

    const sessionId = updated.conversation?.sessionId ?? null;

    if (dto.status !== undefined && dto.status !== fromStatus) {
      void this.auditService
        .log({
          sessionId: sessionId ?? undefined,
          eventType: 'lead_status_changed',
          eventData: { leadId: id, fromStatus, toStatus: dto.status },
        })
        .catch(() => undefined);
    }

    if (dto.note !== undefined && dto.note.trim()) {
      void this.auditService
        .log({
          sessionId: sessionId ?? undefined,
          eventType: 'lead_note_added',
          eventData: { leadId: id },
        })
        .catch(() => undefined);
    }

    return this.toVm(updated);
  }

  // ── Update Status (PATCH /:id/status) ─────────────────────────────────────

  async updateStatus(id: number, dto: UpdateLeadStatusDto): Promise<LeadVm> {
    const existing = await this.prisma.lead.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Lead ${id} not found`);

    const fromStatus = existing.status;

    const updated = (await this.prisma.lead.update({
      where: { id },
      data: { status: dto.status as LeadStatus },
      include: {
        conversation: {
          select: { session_token: true, sessionId: true, status: true },
        },
        tickets: {
          select: { id: true, status: true },
          take: 1,
          orderBy: { createdAt: 'asc' },
        },
      },
    })) as unknown as LeadRow;

    void this.auditService
      .log({
        sessionId: updated.conversation?.sessionId ?? undefined,
        eventType: 'lead_status_changed',
        eventData: { leadId: id, fromStatus, toStatus: dto.status },
      })
      .catch(() => undefined);

    return this.toVm(updated);
  }

  // ── Notifications (deferred) ──────────────────────────────────────────────

  /**
   * GET /api/v1/admin/leads/:id/notifications
   *
   * NOTE: The notification delivery loop (NotificationJob / NotificationDelivery)
   * is deferred to a later notification slice. This endpoint returns an empty
   * list as a compatible placeholder.
   */
  async getNotifications(id: number): Promise<NotificationListResult> {
    const exists = await this.prisma.lead.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException(`Lead ${id} not found`);
    return { data: [], meta: { total: 0, page: 1, pageSize: 20 } };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private toVm(row: LeadRow): LeadVm {
    return {
      id: row.id,
      conversationId: row.conversationId,
      name: row.name,
      email: row.email,
      company: row.company,
      phone: row.phone,
      message: row.message,
      language: row.language,
      type: row.type,
      riskLevel: row.riskLevel,
      confidentialityTriggered: row.confidentialityTriggered,
      promptInjectionDetected: row.promptInjectionDetected,
      sensitiveIntentCount: row.sensitiveIntentCount,
      highIntentScore: row.highIntentScore,
      notificationStatus: row.notificationStatus,
      status: row.status as LeadStatus,
      notes: row.notes,
      sessionToken: row.conversation?.session_token ?? null,
      ticketId: row.tickets?.[0]?.id ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private buildTimeline(row: LeadDetailRow): LeadTimelineEvent[] {
    const events: LeadTimelineEvent[] = [];

    events.push({ event: 'lead_created', at: row.createdAt.toISOString() });

    if (row.status !== 'new') {
      events.push({
        event: 'status_changed',
        at: row.updatedAt.toISOString(),
        content: row.status,
      });
    }

    if (row.notes) {
      events.push({
        event: 'notes_updated',
        at: row.updatedAt.toISOString(),
      });
    }

    return events;
  }
}
