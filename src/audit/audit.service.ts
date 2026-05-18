import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuditLogV2Payload } from './types/audit-log-v2-payload.type';

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
   * Accepts both V1 `AuditLogEvent` and V2 `AuditLogV2Payload` shapes.
   * V2-specific fields (answerMode, sourceReferences, llmCalled, canAnswer,
   * fallbackReason, queryUnderstanding, retrievalPlan, retrievalDecision,
   * retrievalCandidates, trace) are merged into the `eventData` JSON blob so
   * that no DB schema migration is required.
   *
   * This method never throws — if the DB write fails, it logs a warning and
   * returns normally so that the chat pipeline is not interrupted.
   */
  async log(event: AuditLogV2Payload): Promise<void> {
    // Collect V2-only fields that are present on this event.
    const v2Extra: Record<string, unknown> = {};
    if (event.queryUnderstanding !== undefined) v2Extra['queryUnderstanding'] = event.queryUnderstanding;
    if (event.retrievalPlan !== undefined) v2Extra['retrievalPlan'] = event.retrievalPlan;
    if (event.retrievalCandidates !== undefined) v2Extra['retrievalCandidates'] = event.retrievalCandidates;
    if (event.retrievalDecision !== undefined) v2Extra['retrievalDecision'] = event.retrievalDecision;
    if (event.answerMode !== undefined) v2Extra['answerMode'] = event.answerMode;
    if (event.sourceReferences !== undefined) v2Extra['sourceReferences'] = event.sourceReferences;
    if (event.llmCalled !== undefined) v2Extra['llmCalled'] = event.llmCalled;
    if (event.canAnswer !== undefined) v2Extra['canAnswer'] = event.canAnswer;
    if (event.fallbackReason !== undefined) v2Extra['fallbackReason'] = event.fallbackReason;
    if (event.trace !== undefined) v2Extra['trace'] = event.trace;

    const mergedEventData =
      Object.keys(v2Extra).length > 0
        ? { ...(event.eventData ?? {}), ...v2Extra }
        : event.eventData;

    try {
      await this.prisma.auditLog.create({
        data: {
          requestId: event.requestId ?? null,
          sessionId: event.sessionId ?? null,
          eventType: event.eventType,
          eventData: (mergedEventData ?? undefined) as Prisma.InputJsonValue | undefined,
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
