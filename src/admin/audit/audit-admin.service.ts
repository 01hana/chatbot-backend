import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';
import { summarizeAuditEventData } from './audit-event-summary.util';

// ─── View Models ──────────────────────────────────────────────────────────────

export interface AuditLogVm {
  id: number;
  requestId: string | null;
  sessionId: string | null;
  eventType: string;
  /** Summarised event data — full payload omitted from the list response. */
  eventData: Prisma.JsonValue;
  knowledgeRefs: string[];
  ragConfidence: number | null;
  blockedReason: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs: number;
  aiModel: string | null;
  aiProvider: string | null;
  createdAt: string;
}

export interface AuditLogDetailVm extends AuditLogVm {
  promptHash: string | null;
  configSnapshot: Prisma.JsonValue;
}

export interface AuditLogListResult {
  data: AuditLogVm[];
  meta: { total: number; page: number; pageSize: number };
}

// ─── Service ─────────────────────────────────────────────────────────────────

/**
 * AuditAdminService — read-only query service for the `audit_logs` table.
 *
 * IMPORTANT: This service must NEVER call UPDATE or DELETE on audit_logs.
 * Writes are handled exclusively by AuditService (the append-only writer).
 */
@Injectable()
export class AuditAdminService {
  constructor(private readonly prisma: PrismaService) {}

  // ── List ──────────────────────────────────────────────────────────────────

  async list(query: ListAuditLogsQueryDto): Promise<AuditLogListResult> {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';

    const where: Prisma.AuditLogWhereInput = {};

    // requestId — exact match
    if (query.requestId) where.requestId = query.requestId;

    if (query.sessionId) {
      where.sessionId = { contains: query.sessionId, mode: 'insensitive' };
    }
    if (query.eventType) {
      where.eventType = { contains: query.eventType, mode: 'insensitive' };
    }
    if (query.dateFrom !== undefined || query.dateTo !== undefined) {
      where.createdAt = {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
      };
    }

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { [sortBy]: sortOrder },
        // Exclude heavy / internal-only fields from list response
        select: {
          id: true,
          requestId: true,
          sessionId: true,
          eventType: true,
          eventData: true,
          knowledgeRefs: true,
          ragConfidence: true,
          blockedReason: true,
          promptTokens: true,
          completionTokens: true,
          totalTokens: true,
          durationMs: true,
          aiModel: true,
          aiProvider: true,
          createdAt: true,
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data: rows.map((r) => this.toVm(r)),
      meta: { total, page, pageSize },
    };
  }

  // ── Detail ────────────────────────────────────────────────────────────────

  async findOne(id: number): Promise<AuditLogDetailVm> {
    const row = await this.prisma.auditLog.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`AuditLog ${id} not found`);
    return this.toDetailVm(row);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private toVm(
    row: {
      id: number;
      requestId: string | null;
      sessionId: string | null;
      eventType: string;
      eventData: Prisma.JsonValue;
      knowledgeRefs: string[];
      ragConfidence: number | null;
      blockedReason: string | null;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      durationMs: number;
      aiModel: string | null;
      aiProvider: string | null;
      createdAt: Date;
    },
  ): AuditLogVm {
    return {
      id: row.id,
      requestId: row.requestId,
      sessionId: row.sessionId,
      eventType: row.eventType,
      eventData: summarizeAuditEventData(row.eventData),
      knowledgeRefs: row.knowledgeRefs,
      ragConfidence: row.ragConfidence,
      blockedReason: row.blockedReason,
      promptTokens: row.promptTokens,
      completionTokens: row.completionTokens,
      totalTokens: row.totalTokens,
      durationMs: row.durationMs,
      aiModel: row.aiModel,
      aiProvider: row.aiProvider,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toDetailVm(
    row: {
      id: number;
      requestId: string | null;
      sessionId: string | null;
      eventType: string;
      eventData: Prisma.JsonValue;
      knowledgeRefs: string[];
      ragConfidence: number | null;
      blockedReason: string | null;
      promptHash: string | null;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      durationMs: number;
      aiModel: string | null;
      aiProvider: string | null;
      configSnapshot: Prisma.JsonValue;
      createdAt: Date;
    },
  ): AuditLogDetailVm {
    return {
      ...this.toVm(row),
      eventData: row.eventData, // full event data in detail response
      promptHash: row.promptHash,
      configSnapshot: row.configSnapshot,
    };
  }
}
