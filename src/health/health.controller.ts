import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiStatusService } from './ai-status.service';

/**
 * HealthController — provides lightweight liveness / readiness probes.
 *
 * Routes:
 *  GET /api/v1/health           — DB connectivity check
 *  GET /api/v1/health/ai-status — in-memory AI degraded flag
 *
 * NOTE: `GET /api/v1/health/ai-status` is an INTERNAL health/monitoring
 * endpoint.  It is NOT the frontend Widget initialisation contract.
 * The frontend must rely exclusively on `GET /api/v1/widget/config`
 * and its `status` field.  Do NOT expose ai-status as a Widget init
 * dependency.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly aiStatusService: AiStatusService,
  ) {}

  /**
   * Basic liveness + DB readiness probe.
   * Returns 200 when the DB is reachable, 503 otherwise.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  async getHealth(): Promise<{ status: string; db: string }> {
    try {
      await this.prismaService.$queryRaw`SELECT 1`;
      return { status: 'ok', db: 'ok' };
    } catch {
      throw new ServiceUnavailableException({ status: 'error', db: 'error' });
    }
  }

  /**
   * Internal AI status probe (monitoring / ops use only).
   * NOT a frontend Widget initialisation endpoint.
   */
  @Get('ai-status')
  @HttpCode(HttpStatus.OK)
  getAiStatus(): { aiStatus: string } {
    return { aiStatus: this.aiStatusService.getStatus() };
  }
}
