import { Injectable } from '@nestjs/common';
import { Prisma, FeedbackValue } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ListFeedbackQueryDto } from './dto/list-feedback-query.dto';

// ─── View Models ──────────────────────────────────────────────────────────────

export interface FeedbackVm {
  id: number;
  conversationId: number;
  sessionToken: string | null;
  messageId: number;
  value: string;
  reason: string | null;
  createdAt: string;
  messagePreview: string | null;
}

export interface FeedbackListResult {
  data: FeedbackVm[];
  meta: { total: number; page: number; pageSize: number };
}

// ─── Service ─────────────────────────────────────────────────────────────────

/**
 * FeedbackAdminService — admin-facing paginated query for feedback rows.
 *
 * Injects PrismaService directly to join Conversation (for sessionToken) and
 * ConversationMessage (for messagePreview).
 *
 * Does NOT modify the user-facing POST /feedback API.
 */
@Injectable()
export class FeedbackAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListFeedbackQueryDto): Promise<FeedbackListResult> {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';

    const where: Prisma.FeedbackWhereInput = {};

    if (query.conversationId !== undefined) {
      where.conversationId = query.conversationId;
    }
    if (query.messageId !== undefined) {
      where.messageId = query.messageId;
    }
    if (query.value !== undefined) {
      where.value = query.value as FeedbackValue;
    }
    if (query.dateFrom !== undefined || query.dateTo !== undefined) {
      where.createdAt = {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
      };
    }
    // sessionId — join through Conversation
    if (query.sessionId !== undefined) {
      where.conversation = {
        sessionId: { contains: query.sessionId, mode: 'insensitive' },
      };
    }

    type FeedbackRow = {
      id: number;
      conversationId: number;
      messageId: number;
      value: FeedbackValue;
      reason: string | null;
      createdAt: Date;
      conversation: { session_token: string } | null;
      message: { content: string } | null;
    };

    const [rows, total] = await Promise.all([
      this.prisma.feedback.findMany({
        where,
        include: {
          conversation: { select: { session_token: true } },
          message: { select: { content: true } },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { [sortBy]: sortOrder },
      }) as unknown as Promise<FeedbackRow[]>,
      this.prisma.feedback.count({ where }),
    ]);

    return {
      data: rows.map((r) => this.toVm(r as FeedbackRow)),
      meta: { total, page, pageSize },
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private toVm(row: {
    id: number;
    conversationId: number;
    messageId: number;
    value: FeedbackValue;
    reason: string | null;
    createdAt: Date;
    conversation: { session_token: string } | null;
    message: { content: string } | null;
  }): FeedbackVm {
    return {
      id: row.id,
      conversationId: row.conversationId,
      sessionToken: row.conversation?.session_token ?? null,
      messageId: row.messageId,
      value: row.value,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
      messagePreview: row.message?.content
        ? row.message.content.slice(0, 120)
        : null,
    };
  }
}
