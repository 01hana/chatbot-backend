import { Injectable } from '@nestjs/common';

export type AiStatus = 'normal' | 'degraded';

/**
 * AiStatusService — tracks the in-memory AI operational status.
 *
 * Phase 0: simple boolean flip (always "normal" on boot).
 * Phase 2: LLM failure counter will call `setDegraded(true)` when the
 *           consecutive failure threshold is reached.
 *
 * This service is intentionally NOT @Global — it is provided and owned by
 * HealthModule, and exported so that Phase 2's ChatPipeline can inject it.
 */
@Injectable()
export class AiStatusService {
  private degraded = false;

  isDegraded(): boolean {
    return this.degraded;
  }

  setDegraded(value: boolean): void {
    this.degraded = value;
  }

  getStatus(): AiStatus {
    return this.degraded ? 'degraded' : 'normal';
  }
}
