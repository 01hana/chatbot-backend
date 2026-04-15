import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SafetyRule, BlacklistEntry } from '../generated/prisma/client';

/**
 * SafetyRepository — thin data-access layer for safety-related tables.
 *
 * Responsibilities:
 *  - Query `safety_rules` for prompt-injection / jailbreak patterns.
 *  - Query `blacklist_entries` for confidential / internal keywords.
 *  - No business logic; all filtering / matching lives in SafetyService.
 */
@Injectable()
export class SafetyRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Return all active safety rules from the database.
   * Results are used to populate SafetyService's in-memory cache on startup.
   */
  async findAllRules(): Promise<SafetyRule[]> {
    return this.prisma.safetyRule.findMany({
      where: { isActive: true },
      orderBy: { id: 'asc' },
    });
  }

  /**
   * Return all active blacklist entries from the database.
   * Results are used to populate SafetyService's in-memory cache on startup.
   */
  async findAllBlacklist(): Promise<BlacklistEntry[]> {
    return this.prisma.blacklistEntry.findMany({
      where: { isActive: true },
      orderBy: { id: 'asc' },
    });
  }
}
