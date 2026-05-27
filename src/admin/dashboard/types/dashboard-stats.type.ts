/** Thin view model for recent audit events surfaced on the Dashboard. */
export interface LatestAuditEventVm {
  id: number;
  eventType: string;
  /** Human-readable one-line summary derived from eventType / eventData.action. */
  summary: string;
  createdAt: string;
}

/**
 * DashboardStats — frontend Phase 3 Dashboard contract.
 *
 * GET /api/v1/admin/dashboard (no required query params).
 *
 * Chart arrays (conversationTrend, intentDistribution, handoffReasonDistribution)
 * are deferred — format not yet defined. They always return [].
 */
export interface DashboardStats {
  /** Conversations created today (server local day). */
  todayConversations: number;
  /** Conversations created in the current calendar month. */
  monthlyConversations: number;
  /**
   * Estimated AI resolution rate for the current month.
   * = max(monthlyConversations - monthHandoffTickets, 0) / monthlyConversations
   * Returns 0 when monthlyConversations = 0.
   * TODO: refine after conversation → handoff/ticket relation is fully normalised.
   */
  aiResolutionRate: number;
  /** Tickets currently in open or in_progress status (not date-scoped). */
  pendingTickets: number;
  /** Leads created in the current calendar month. */
  monthlyLeads: number;

  /** Daily conversation counts for the current month. Format TBD — always []. */
  conversationTrend: Array<Record<string, unknown>>;
  /** Intent frequency distribution. Format TBD — always []. */
  intentDistribution: Array<Record<string, unknown>>;
  /** Handoff reason breakdown. Format TBD — always []. */
  handoffReasonDistribution: Array<Record<string, unknown>>;

  /** Latest 5 audit log events, newest first. */
  latestAuditEvents: LatestAuditEventVm[];
}
