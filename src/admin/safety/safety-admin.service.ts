import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SafetyService } from '../../safety/safety.service.js';
import {
  CreateSafetyRuleDto,
  UpdateSafetyRuleDto,
  CreateBlacklistEntryDto,
  UpdateBlacklistEntryDto,
} from './dto/safety-admin.dto.js';
import { SafetyRule, BlacklistEntry } from '../../generated/prisma/client';

/**
 * AdminSafetyService — handles CRUD for SafetyRule and BlacklistEntry.
 *
 * Every mutation calls `SafetyService.invalidateCache()` so that the next
 * call to `scanPrompt()` or `checkConfidentiality()` reloads rules from DB.
 *
 * DELETE operations are soft-disables (`isActive = false`) — no rows are
 * ever hard-deleted via this service.
 */
@Injectable()
export class AdminSafetyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly safetyService: SafetyService,
  ) {}

  // ── SafetyRule ─────────────────────────────────────────────────────────

  /**
   * Create a new SafetyRule row.
   * The rule is active by default unless `isActive` is explicitly set to false.
   */
  async createRule(dto: CreateSafetyRuleDto): Promise<SafetyRule> {
    const rule = await this.prisma.safetyRule.create({
      data: {
        type: dto.type,
        pattern: dto.pattern,
        isRegex: dto.isRegex,
        isActive: dto.isActive ?? true,
      },
    });
    await this.safetyService.invalidateCache();
    return rule;
  }

  /**
   * Partially update an existing SafetyRule by ID.
   * Throws `NotFoundException` if the rule does not exist.
   */
  async updateRule(id: number, dto: UpdateSafetyRuleDto): Promise<SafetyRule> {
    await this.assertRuleExists(id);
    const rule = await this.prisma.safetyRule.update({
      where: { id },
      data: dto,
    });
    await this.safetyService.invalidateCache();
    return rule;
  }

  /**
   * Soft-disable a SafetyRule by setting `isActive = false`.
   * Throws `NotFoundException` if the rule does not exist.
   * No rows are hard-deleted.
   */
  async disableRule(id: number): Promise<SafetyRule> {
    await this.assertRuleExists(id);
    const rule = await this.prisma.safetyRule.update({
      where: { id },
      data: { isActive: false },
    });
    await this.safetyService.invalidateCache();
    return rule;
  }

  // ── BlacklistEntry ────────────────────────────────────────────────────

  /**
   * Create a new BlacklistEntry row.
   * The entry is active by default unless `isActive` is explicitly set to false.
   */
  async createEntry(dto: CreateBlacklistEntryDto): Promise<BlacklistEntry> {
    const entry = await this.prisma.blacklistEntry.create({
      data: {
        keyword: dto.keyword,
        type: dto.type,
        isActive: dto.isActive ?? true,
      },
    });
    await this.safetyService.invalidateCache();
    return entry;
  }

  /**
   * Partially update an existing BlacklistEntry by ID.
   * Throws `NotFoundException` if the entry does not exist.
   */
  async updateEntry(id: number, dto: UpdateBlacklistEntryDto): Promise<BlacklistEntry> {
    await this.assertEntryExists(id);
    const entry = await this.prisma.blacklistEntry.update({
      where: { id },
      data: dto,
    });
    await this.safetyService.invalidateCache();
    return entry;
  }

  /**
   * Soft-disable a BlacklistEntry by setting `isActive = false`.
   * Throws `NotFoundException` if the entry does not exist.
   * No rows are hard-deleted.
   */
  async disableEntry(id: number): Promise<BlacklistEntry> {
    await this.assertEntryExists(id);
    const entry = await this.prisma.blacklistEntry.update({
      where: { id },
      data: { isActive: false },
    });
    await this.safetyService.invalidateCache();
    return entry;
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private async assertRuleExists(id: number): Promise<void> {
    const exists = await this.prisma.safetyRule.findUnique({ where: { id } });
    if (!exists) {
      throw new NotFoundException(`SafetyRule with id ${id} not found`);
    }
  }

  private async assertEntryExists(id: number): Promise<void> {
    const exists = await this.prisma.blacklistEntry.findUnique({ where: { id } });
    if (!exists) {
      throw new NotFoundException(`BlacklistEntry with id ${id} not found`);
    }
  }
}
