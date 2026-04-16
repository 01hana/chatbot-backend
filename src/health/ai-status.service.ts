import { Injectable, Logger } from '@nestjs/common';
import { SystemConfigService } from '../system-config/system-config.service';

export type AiStatus = 'normal' | 'degraded';

/**
 * AiStatusService — tracks the in-memory AI operational status.
 *
 * Phase 2 (T2-009):
 *  - `recordFailure()` increments the consecutive-failure counter.
 *  - When the counter reaches `SystemConfig.ai_degraded_threshold` (default 3),
 *    `degraded` is set to true.
 *  - `recordSuccess()` resets the counter and clears degraded mode.
 *  - WidgetConfigService reads `isDegraded()` to set `status: "degraded"`.
 *
 * This service is exported from HealthModule so that ChatPipelineService can
 * call `recordFailure()` / `recordSuccess()` after each LLM call.
 */
@Injectable()
export class AiStatusService {
  private readonly logger = new Logger(AiStatusService.name);
  private degraded = false;
  private consecutiveFailures = 0;

  constructor(private readonly systemConfigService: SystemConfigService) {}

  isDegraded(): boolean {
    return this.degraded;
  }

  setDegraded(value: boolean): void {
    this.degraded = value;
    if (!value) this.consecutiveFailures = 0;
  }

  getStatus(): AiStatus {
    return this.degraded ? 'degraded' : 'normal';
  }

  /**
   * Call after each LLM failure.
   * Activates degraded mode when the failure count exceeds the threshold.
   */
  recordFailure(): void {
    this.consecutiveFailures += 1;
    const threshold = this.systemConfigService.getNumber('ai_degraded_threshold') ?? 3;
    if (!this.degraded && this.consecutiveFailures >= threshold) {
      this.degraded = true;
      this.logger.warn(
        `AI degraded mode activated after ${this.consecutiveFailures} consecutive failures`,
      );
    }
  }

  /**
   * Call after a successful LLM call.
   * Resets the failure counter and clears degraded mode.
   */
  recordSuccess(): void {
    if (this.consecutiveFailures > 0 || this.degraded) {
      this.logger.log('AI recovered — resetting degraded state');
    }
    this.consecutiveFailures = 0;
    this.degraded = false;
  }

  /** Exposed for testing. */
  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }
}
