import type { Prisma } from '../../generated/prisma/client';

/**
 * Summarises an AuditLog `eventData` JSON object for list / non-detail responses.
 *
 * Strips large or internal-only fields (rawQuery, full retrievalCandidates content,
 * full knowledge content, full token arrays, etc.) while preserving the diagnostic
 * fields that are useful to admin UIs.
 *
 * The full payload is preserved in detail (GET …/:id) responses.
 */
export function summarizeAuditEventData(eventData: Prisma.JsonValue): Prisma.JsonValue {
  if (!eventData || typeof eventData !== 'object' || Array.isArray(eventData)) {
    return eventData;
  }

  const d = eventData as Record<string, unknown>;
  const summary: Record<string, unknown> = {};

  // ── Scalar diagnostic fields ──────────────────────────────────────────────
  const scalarFields = [
    'action',
    'canAnswer',
    'answerMode',
    'intentLabel',
    'confidenceLevel',
    'fallbackReason',
  ] as const;

  for (const field of scalarFields) {
    if (d[field] !== undefined) summary[field] = d[field];
  }

  // ── sourceReferences — emit count only ────────────────────────────────────
  if (Array.isArray(d.sourceReferences)) {
    summary.sourceReferenceCount = d.sourceReferences.length;
  }

  // ── retrievalDecision — reason + confidence only ──────────────────────────
  if (
    d.retrievalDecision &&
    typeof d.retrievalDecision === 'object' &&
    !Array.isArray(d.retrievalDecision)
  ) {
    const rd = d.retrievalDecision as Record<string, unknown>;
    summary.retrievalDecision = {
      ...(rd.reason !== undefined ? { reason: rd.reason } : {}),
      ...(rd.confidence !== undefined ? { confidence: rd.confidence } : {}),
    };
  }

  // ── queryUnderstanding — queryType + supportability only ─────────────────
  if (
    d.queryUnderstanding &&
    typeof d.queryUnderstanding === 'object' &&
    !Array.isArray(d.queryUnderstanding)
  ) {
    const qu = d.queryUnderstanding as Record<string, unknown>;
    summary.queryUnderstanding = {
      ...(qu.queryType !== undefined ? { queryType: qu.queryType } : {}),
      ...(qu.supportability !== undefined ? { supportability: qu.supportability } : {}),
    };
  }

  return summary as Prisma.JsonValue;
}
