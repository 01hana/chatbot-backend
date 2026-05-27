import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DashboardStats, LatestAuditEventVm } from './types/dashboard-stats.type';

/** Shape of a raw AuditLog row fetched for the latest-events panel. */
interface AuditLogRow {
  id: number;
  eventType: string;
  eventData: Prisma.JsonValue;
  createdAt: Date;
}

/**
 * DashboardAdminService — aggregates multi-table statistics for the frontend
 * Phase 3 Dashboard.
 *
 * getStats(month?) accepts an optional YYYY-MM string.
 * When omitted the current server calendar month is used.
 *
 * All DB queries are issued in a single Promise.all — no N+1.
 *
 * aiResolutionRate simplified formula:
 *   aiResolved = max(monthlyConversations - monthHandoffTickets, 0)
 *   aiResolutionRate = monthlyConversations > 0
 *     ? aiResolved / monthlyConversations : 0
 *   TODO: refine after conversation → handoff/ticket relation is fully normalised.
 */
@Injectable()
export class DashboardAdminService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Return dashboard stats for the given month (defaults to current month).
   *
   * @param month Optional YYYY-MM string. Throws 400 when format is invalid.
   */
  async getStats(month?: string): Promise<DashboardStats> {
    const { monthStart, monthEnd, todayStart, todayEnd } =
      this.buildDateRanges(month);

    const [
      todayConversations,
      monthlyConversations,
      monthlyLeads,
      pendingTickets,
      monthHandoffTickets,
      latestAuditRows,
    ] = await Promise.all([
      // 1. Today's conversations
      this.prisma.conversation.count({
        where: { createdAt: { gte: todayStart, lte: todayEnd }, deletedAt: null },
      }),

      // 2. This month's conversations
      this.prisma.conversation.count({
        where: { createdAt: { gte: monthStart, lte: monthEnd }, deletedAt: null },
      }),

      // 3. This month's leads
      this.prisma.lead.count({
        where: { createdAt: { gte: monthStart, lte: monthEnd }, deletedAt: null },
      }),

      // 4. All currently pending tickets (not date-scoped — running total)
      this.prisma.ticket.count({
        where: {
          status: { in: ['open', 'in_progress'] },
          deletedAt: null,
        },
      }),

      // 5. This month's handoff tickets (used for aiResolutionRate)
      this.prisma.ticket.count({
        where: {
          triggerReason: 'handoff',
          createdAt: { gte: monthStart, lte: monthEnd },
          deletedAt: null,
        },
      }),

      // 6. Latest 5 audit log events
      this.prisma.auditLog.findMany({
        select: { id: true, eventType: true, eventData: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }) as unknown as Promise<AuditLogRow[]>,
    ]);

    // ── Derived values ────────────────────────────────────────────────────────

    const aiResolved = Math.max(monthlyConversations - monthHandoffTickets, 0);
    const aiResolutionRate =
      monthlyConversations > 0 ? aiResolved / monthlyConversations : 0;

    const latestAuditEvents: LatestAuditEventVm[] = latestAuditRows.map((row) =>
      this.toAuditEventVm(row),
    );

    return {
      todayConversations,
      monthlyConversations,
      aiResolutionRate,
      pendingTickets,
      monthlyLeads,
      // Chart arrays — format TBD, always empty for now
      conversationTrend: [],
      intentDistribution: [],
      handoffReasonDistribution: [],
      latestAuditEvents,
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Compute the four Date boundaries needed for the dashboard queries.
   *
   * @throws BadRequestException when month is present but not in YYYY-MM format.
   */
  private buildDateRanges(month?: string): {
    monthStart: Date;
    monthEnd: Date;
    todayStart: Date;
    todayEnd: Date;
  } {
    let year: number;
    let mon: number; // 0-indexed

    if (month) {
      const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
      if (!match) {
        throw new BadRequestException(
          'month must be a valid YYYY-MM string (e.g. 2026-01)',
        );
      }
      year = parseInt(match[1], 10);
      mon = parseInt(match[2], 10) - 1;
    } else {
      const now = new Date();
      year = now.getUTCFullYear();
      mon = now.getUTCMonth();
    }

    const monthStart = new Date(Date.UTC(year, mon, 1, 0, 0, 0, 0));
    // Last day of month: day-0 of the next month
    const monthEnd = new Date(Date.UTC(year, mon + 1, 0, 23, 59, 59, 999));

    const now = new Date();
    const todayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
    );
    const todayEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999),
    );

    return { monthStart, monthEnd, todayStart, todayEnd };
  }

  /**
   * Convert a raw AuditLog row to LatestAuditEventVm.
   * Summary = eventType, optionally suffixed with eventData.action.
   * Full eventData is never included in the response.
   */
  private toAuditEventVm(row: AuditLogRow): LatestAuditEventVm {
    let summary = row.eventType;
    if (
      row.eventData !== null &&
      typeof row.eventData === 'object' &&
      !Array.isArray(row.eventData)
    ) {
      const action = (row.eventData as Record<string, unknown>).action;
      if (typeof action === 'string' && action) {
        summary = `${row.eventType}: ${action}`;
      }
    }
    return {
      id: row.id,
      eventType: row.eventType,
      summary,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
