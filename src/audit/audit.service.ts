import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogEvent } from './types/audit-log-event.type';

/**
 * AuditService — append-only writer for the `audit_logs` table.
 *
 * IMPORTANT: This service must NEVER call UPDATE or DELETE on audit_logs.
 * All writes are strictly INSERT (append). The immutability of the audit trail
 * is a compliance requirement.
 *
 * Non-critical: logging errors are swallowed with a warning so that an audit
 * failure never blocks the primary chat response.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Append a single audit event to the database.
   *
   * This method never throws — if the DB write fails, it logs a warning and
   * returns normally so that the chat pipeline is not interrupted.
   */
  async log(event: AuditLogEvent): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          requestId: event.requestId ?? null,
          sessionId: event.sessionId ?? null,
          eventType: event.eventType,
          eventData: (event.eventData ?? undefined) as Prisma.InputJsonValue | undefined,
          knowledgeRefs: event.knowledgeRefs ?? [],
          ragConfidence: event.ragConfidence ?? null,
          blockedReason: event.blockedReason ?? null,
          promptHash: event.promptHash ?? null,
          promptTokens: event.promptTokens ?? 0,
          completionTokens: event.completionTokens ?? 0,
          totalTokens: event.totalTokens ?? 0,
          durationMs: event.durationMs ?? 0,
          aiModel: event.aiModel ?? null,
          aiProvider: event.aiProvider ?? null,
          configSnapshot: (event.configSnapshot ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (err) {
      this.logger.warn(
        `AuditService.log failed (eventType=${event.eventType}): ${(err as Error).message}`,
      );
    }
  }
}
