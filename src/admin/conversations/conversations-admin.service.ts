import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FeedbackService } from '../../feedback/feedback.service';
import type { ConversationFeedbackSummary } from '../../feedback/feedback.repository';
import { ListConversationsQueryDto } from './dto/list-conversations-query.dto';
import { summarizeAuditEventData } from '../audit/audit-event-summary.util';

// ─── View Models ──────────────────────────────────────────────────────────────

export interface ConversationSummaryVm {
  id: number;
  sessionId: string;
  sessionToken: string;
  createdAt: string;
  updatedAt: string;
  language: string;
  status: string;
  type: string;
  messageCount: number;
  hasFeedback: boolean;
  hasConfidential: boolean;
  hasPromptInjection: boolean;
  lastMessagePreview: string | null;
}

export interface ConversationMessageVm {
  id: number;
  role: string;
  type: string;
  content: string;
  createdAt: string;
  riskLevel: string | null;
  blockedReason: string | null;
}

export interface AuditEventSummaryVm {
  id: number;
  eventType: string;
  eventData: Prisma.JsonValue;
  createdAt: string;
}

export interface ConversationDetailVm {
  id: number;
  sessionId: string;
  sessionToken: string;
  language: string;
  status: string;
  type: string;
  riskLevel: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  messages: ConversationMessageVm[];
  auditEvents: AuditEventSummaryVm[];
  feedbackSummary: ConversationFeedbackSummary;
}

export interface ConversationListResult {
  data: ConversationSummaryVm[];
  meta: { total: number; page: number; pageSize: number };
}

export interface ConversationExportResult {
  url: string;
}

// ─── Service ─────────────────────────────────────────────────────────────────

/**
 * ConversationsAdminService — admin-facing queries for Conversation data.
 *
 * Injects PrismaService directly for complex join/aggregation queries that
 * are not supported by the user-facing ConversationService.
 */
@Injectable()
export class ConversationsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly feedbackService: FeedbackService,
  ) {}

  // ── List ──────────────────────────────────────────────────────────────────

  async list(query: ListConversationsQueryDto): Promise<ConversationListResult> {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';

    const where = await this.buildConversationWhere(query);

    type ConvRow = Awaited<
      ReturnType<typeof this.prisma.conversation.findMany>
    >[number] & {
      _count: { messages: number; feedbacks: number };
      messages: { content: string; createdAt: Date }[];
    };

    const [rows, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where,
        include: {
          _count: { select: { messages: true, feedbacks: true } },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { content: true, createdAt: true },
          },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { [sortBy]: sortOrder },
      }) as unknown as Promise<ConvRow[]>,
      this.prisma.conversation.count({ where }),
    ]);

    // Batch-query prompt-injection status for all returned rows
    const sessionIds = rows.map((r) => r.sessionId);
    const injectionSet = new Set<string>();
    if (sessionIds.length > 0) {
      const injLogs = await this.prisma.auditLog.findMany({
        where: {
          sessionId: { in: sessionIds },
          eventType: 'prompt_guard_blocked',
        },
        select: { sessionId: true },
        distinct: ['sessionId'],
      });
      injLogs.forEach((l) => l.sessionId && injectionSet.add(l.sessionId));
    }

    return {
      data: rows.map((r) => this.toSummaryVm(r as ConvRow, injectionSet)),
      meta: { total, page, pageSize },
    };
  }

  // ── Detail ────────────────────────────────────────────────────────────────

  async findOne(id: number): Promise<ConversationDetailVm> {
    type ConvWithMessages = Awaited<
      ReturnType<typeof this.prisma.conversation.findUnique>
    > & {
      _count: { messages: number };
      messages: {
        id: number;
        role: string;
        type: string;
        content: string;
        createdAt: Date;
        riskLevel: string | null;
        blockedReason: string | null;
      }[];
    };

    const conv = (await this.prisma.conversation.findUnique({
      where: { id },
      include: {
        _count: { select: { messages: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    })) as ConvWithMessages | null;

    if (!conv) throw new NotFoundException(`Conversation ${id} not found`);

    const [auditEvents, feedbackSummary] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { sessionId: conv.sessionId },
        orderBy: { createdAt: 'asc' },
        take: 200,
      }),
      this.feedbackService.getConversationSummary(id),
    ]);

    return {
      id: conv.id,
      sessionId: conv.sessionId,
      sessionToken: conv.session_token,
      language: conv.language,
      status: conv.status,
      type: conv.type,
      riskLevel: conv.riskLevel ?? null,
      createdAt: conv.createdAt.toISOString(),
      updatedAt: conv.updatedAt.toISOString(),
      messageCount: conv._count.messages,
      messages: conv.messages.map((m) => ({
        id: m.id,
        role: m.role,
        type: m.type,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
        riskLevel: m.riskLevel ?? null,
        blockedReason: m.blockedReason ?? null,
      })),
      auditEvents: auditEvents.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        eventData: summarizeAuditEventData(e.eventData),
        createdAt: e.createdAt.toISOString(),
      })),
      feedbackSummary,
    };
  }

  // ── Export ────────────────────────────────────────────────────────────────

  async export(query: ListConversationsQueryDto): Promise<ConversationExportResult> {
    // Build same filter conditions as list(), but fetch up to 10,000 rows (no pageSize cap)
    const where = await this.buildConversationWhere(query);

    type ConvRow = Awaited<
      ReturnType<typeof this.prisma.conversation.findMany>
    >[number] & {
      _count: { messages: number; feedbacks: number };
      messages: { content: string; createdAt: Date }[];
    };

    const convRows = (await this.prisma.conversation.findMany({
      where,
      include: {
        _count: { select: { messages: true, feedbacks: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true, createdAt: true },
        },
      },
      take: 10000,
      orderBy: { createdAt: 'desc' },
    })) as unknown as ConvRow[];

    // Batch-query prompt-injection for export rows
    const exportSessionIds = convRows.map((r) => r.sessionId);
    const injectionSet = new Set<string>();
    if (exportSessionIds.length > 0) {
      const injLogs = await this.prisma.auditLog.findMany({
        where: {
          sessionId: { in: exportSessionIds },
          eventType: 'prompt_guard_blocked',
        },
        select: { sessionId: true },
        distinct: ['sessionId'],
      });
      injLogs.forEach((l) => l.sessionId && injectionSet.add(l.sessionId));
    }

    const data = convRows.map((r) => this.toSummaryVm(r, injectionSet));

    const header = [
      'sessionToken',
      'createdAt',
      'language',
      'status',
      'type',
      'messageCount',
      'lastMessagePreview',
    ].join(',');

    const escapeCsv = (val: unknown): string => {
      const str = val === null || val === undefined ? '' : String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const csvRows = data.map((row) =>
      [
        row.sessionToken,
        row.createdAt,
        row.language,
        row.status,
        row.type,
        row.messageCount,
        row.lastMessagePreview,
      ]
        .map(escapeCsv)
        .join(','),
    );

    const csv = [header, ...csvRows].join('\n');
    const base64 = Buffer.from(csv, 'utf-8').toString('base64');
    return { url: `data:text/csv;base64,${base64}` };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Builds the Prisma `where` clause for conversation queries.
   * Shared by list() and export() so both use identical filter semantics.
   * Async because hasPromptInjection and intentLabel require AuditLog pre-fetches.
   */
  private async buildConversationWhere(
    query: ListConversationsQueryDto,
  ): Promise<Prisma.ConversationWhereInput> {
    const andConditions: Prisma.ConversationWhereInput[] = [{ deletedAt: null }];

    if (query.sessionId) {
      andConditions.push({
        sessionId: { contains: query.sessionId, mode: 'insensitive' },
      });
    }
    if (query.language) andConditions.push({ language: query.language });
    if (query.status) andConditions.push({ status: query.status });
    if (query.type) andConditions.push({ type: query.type });

    if (query.dateFrom !== undefined || query.dateTo !== undefined) {
      andConditions.push({
        createdAt: {
          ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
          ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
        },
      });
    }

    if (query.hasFeedback === true) {
      andConditions.push({ feedbacks: { some: {} } });
    } else if (query.hasFeedback === false) {
      andConditions.push({ feedbacks: { none: {} } });
    }

    if (query.hasConfidential === true) {
      andConditions.push({
        OR: [{ type: 'confidential' }, { riskLevel: 'high' }],
      });
    }

    if (query.keyword) {
      andConditions.push({
        OR: [
          { session_token: { contains: query.keyword, mode: 'insensitive' } },
          { sessionId: { contains: query.keyword, mode: 'insensitive' } },
          {
            messages: {
              some: { content: { contains: query.keyword, mode: 'insensitive' } },
            },
          },
        ],
      });
    }

    // Async filters (hasPromptInjection + intentLabel) — run in parallel
    const [injSessionIds, intentSessionIds] = await Promise.all([
      query.hasPromptInjection === true
        ? this.prisma.auditLog
            .findMany({
              where: { eventType: 'prompt_guard_blocked' },
              select: { sessionId: true },
              distinct: ['sessionId'],
            })
            .then((rows) =>
              rows.map((r) => r.sessionId).filter((s): s is string => !!s),
            )
        : Promise.resolve(null),
      query.intentLabel
        ? this.prisma.auditLog
            .findMany({
              where: {
                eventData: { path: ['intentLabel'], equals: query.intentLabel },
              },
              select: { sessionId: true },
              distinct: ['sessionId'],
            })
            .then((rows) =>
              rows.map((r) => r.sessionId).filter((s): s is string => !!s),
            )
        : Promise.resolve(null),
    ]);

    if (injSessionIds !== null) {
      andConditions.push({ sessionId: { in: injSessionIds } });
    }
    if (intentSessionIds !== null) {
      andConditions.push({ sessionId: { in: intentSessionIds } });
    }

    return andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
  }

  private toSummaryVm(
    row: {
      id: number;
      sessionId: string;
      session_token: string;
      createdAt: Date;
      updatedAt: Date;
      language: string;
      status: string;
      type: string;
      riskLevel: string | null;
      _count: { messages: number; feedbacks: number };
      messages: { content: string }[];
    },
    injectionSet: Set<string>,
  ): ConversationSummaryVm {
    return {
      id: row.id,
      sessionId: row.sessionId,
      sessionToken: row.session_token,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      language: row.language,
      status: row.status,
      type: row.type,
      messageCount: row._count.messages,
      hasFeedback: row._count.feedbacks > 0,
      hasConfidential:
        row.type === 'confidential' || row.riskLevel === 'high',
      hasPromptInjection: injectionSet.has(row.sessionId),
      lastMessagePreview:
        row.messages[0]?.content != null
          ? row.messages[0].content.slice(0, 120)
          : null,
    };
  }
}
