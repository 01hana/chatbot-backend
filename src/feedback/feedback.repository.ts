import { Injectable } from '@nestjs/common';
import {
  Conversation,
  ConversationMessage,
  Feedback,
  FeedbackValue,
  Prisma,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// ─── Param / Result types ─────────────────────────────────────────────────────

export interface FeedbackListParams {
  conversationId?: number;
  value?: FeedbackValue;
  skip?: number;
  take?: number;
}

export interface ConversationFeedbackSummary {
  totalCount: number;
  upCount: number;
  downCount: number;
  reasons: { label: string; count: number }[];
}

export interface DashboardFeedbackSummary {
  totalCount: number;
  upCount: number;
  downCount: number;
  upRate: number;
}

// ─── Repository ───────────────────────────────────────────────────────────────

/**
 * FeedbackRepository — data-access layer for the `feedbacks` table.
 *
 * Also provides thin lookups for Conversation and ConversationMessage so that
 * FeedbackService does not need to depend on ConversationModule.
 */
@Injectable()
export class FeedbackRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Conversation / Message helpers ────────────────────────────────────────

  /** Find a Conversation by its external session_token. */
  async findConversationByToken(sessionToken: string): Promise<Conversation | null> {
    return this.prisma.conversation.findUnique({ where: { session_token: sessionToken } });
  }

  /** Find a ConversationMessage by its primary key. */
  async findMessageById(messageId: number): Promise<ConversationMessage | null> {
    return this.prisma.conversationMessage.findUnique({ where: { id: messageId } });
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  /** Create a new Feedback row. */
  async createFeedback(data: Prisma.FeedbackUncheckedCreateInput): Promise<Feedback> {
    return this.prisma.feedback.create({ data });
  }

  /** Delete all Feedback rows for a given messageId (used by the upsert strategy). */
  async deleteByMessageId(messageId: number): Promise<void> {
    await this.prisma.feedback.deleteMany({ where: { messageId } });
  }

  /** Return the most-recent Feedback for a message (null when none exists). */
  async findByMessageId(messageId: number): Promise<Feedback | null> {
    return this.prisma.feedback.findFirst({
      where: { messageId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Paginated list with optional filters. */
  async list(params: FeedbackListParams): Promise<{ items: Feedback[]; total: number }> {
    const where: Prisma.FeedbackWhereInput = {};
    if (params.conversationId !== undefined) where.conversationId = params.conversationId;
    if (params.value !== undefined) where.value = params.value;

    const [items, total] = await Promise.all([
      this.prisma.feedback.findMany({
        where,
        skip: params.skip ?? 0,
        take: params.take ?? 50,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.feedback.count({ where }),
    ]);

    return { items, total };
  }

  // ── Aggregations ──────────────────────────────────────────────────────────

  /**
   * Return feedback summary for a single conversation.
   * Used by the admin Conversation-detail panel.
   */
  async summaryByConversation(
    conversationId: number,
  ): Promise<ConversationFeedbackSummary> {
    const [totalCount, upCount, reasonGroups] = await Promise.all([
      this.prisma.feedback.count({ where: { conversationId } }),
      this.prisma.feedback.count({ where: { conversationId, value: FeedbackValue.up } }),
      this.prisma.feedback.groupBy({
        by: ['reason'],
        where: { conversationId, reason: { not: null } },
        _count: { reason: true },
      }),
    ]);

    return {
      totalCount,
      upCount,
      downCount: totalCount - upCount,
      reasons: reasonGroups
        .filter((row) => row.reason !== null)
        .map((row) => ({ label: row.reason as string, count: row._count.reason })),
    };
  }

  /**
   * Return global feedback summary, optionally scoped to a date range.
   * Used by the admin Dashboard.
   */
  async dashboardSummary(
    dateRange?: { from?: Date; to?: Date },
  ): Promise<DashboardFeedbackSummary> {
    const where: Prisma.FeedbackWhereInput = {};
    if (dateRange?.from !== undefined || dateRange?.to !== undefined) {
      where.createdAt = {
        ...(dateRange?.from ? { gte: dateRange.from } : {}),
        ...(dateRange?.to ? { lte: dateRange.to } : {}),
      };
    }

    const [totalCount, upCount] = await Promise.all([
      this.prisma.feedback.count({ where }),
      this.prisma.feedback.count({ where: { ...where, value: FeedbackValue.up } }),
    ]);

    return {
      totalCount,
      upCount,
      downCount: totalCount - upCount,
      upRate: totalCount === 0 ? 0 : upCount / totalCount,
    };
  }

  /** Count all feedback rows matching a specific value. */
  async countByValue(value: FeedbackValue): Promise<number> {
    return this.prisma.feedback.count({ where: { value } });
  }
}
