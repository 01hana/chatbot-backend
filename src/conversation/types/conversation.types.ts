/**
 * Minimal conversation info returned to the frontend on session creation.
 * Intentionally does NOT include the internal sessionId.
 */
export interface CreateSessionResult {
  sessionToken: string;
  createdAt: Date;
}
