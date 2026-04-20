import {
  Controller,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  CreateSafetyRuleDto,
  UpdateSafetyRuleDto,
  CreateBlacklistEntryDto,
  UpdateBlacklistEntryDto,
} from './dto/safety-admin.dto.js';
import { AdminSafetyService } from './safety-admin.service.js';

/**
 * AdminSafetyController — CRUD endpoints for SafetyRule and BlacklistEntry.
 *
 * Routes (all under `/api/v1/admin/`):
 *
 *   POST   /admin/safety-rules          → create a new rule
 *   PATCH  /admin/safety-rules/:id      → update an existing rule
 *   DELETE /admin/safety-rules/:id      → soft-disable a rule (isActive=false)
 *
 *   POST   /admin/blacklist             → create a new blacklist entry
 *   PATCH  /admin/blacklist/:id         → update an existing entry
 *   DELETE /admin/blacklist/:id         → soft-disable an entry (isActive=false)
 *
 * Each mutating operation triggers `SafetyService.invalidateCache()` via the
 * service layer, so the in-memory rule cache is reloaded on the next scan.
 *
 * Note: Auth / RBAC is deferred per spec.md — no guards yet.
 */
@Controller('admin')
export class AdminSafetyController {
  constructor(private readonly adminSafetyService: AdminSafetyService) {}

  // ── SafetyRule ───────────────────────────────────────────────────────────

  /**
   * Create a new SafetyRule.
   * Returns `201 Created` with the persisted rule object.
   */
  @Post('safety-rules')
  @HttpCode(HttpStatus.CREATED)
  createRule(@Body() dto: CreateSafetyRuleDto) {
    return this.adminSafetyService.createRule(dto);
  }

  /**
   * Update an existing SafetyRule by ID.
   * Returns the updated rule; throws 404 if not found.
   */
  @Patch('safety-rules/:id')
  updateRule(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSafetyRuleDto,
  ) {
    return this.adminSafetyService.updateRule(id, dto);
  }

  /**
   * Soft-disable a SafetyRule by ID (`isActive = false`).
   * Returns `204 No Content`; throws 404 if not found.
   */
  @Delete('safety-rules/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  disableRule(@Param('id', ParseIntPipe) id: number) {
    return this.adminSafetyService.disableRule(id);
  }

  // ── BlacklistEntry ──────────────────────────────────────────────────────

  /**
   * Create a new BlacklistEntry.
   * Returns `201 Created` with the persisted entry object.
   */
  @Post('blacklist')
  @HttpCode(HttpStatus.CREATED)
  createEntry(@Body() dto: CreateBlacklistEntryDto) {
    return this.adminSafetyService.createEntry(dto);
  }

  /**
   * Update an existing BlacklistEntry by ID.
   * Returns the updated entry; throws 404 if not found.
   */
  @Patch('blacklist/:id')
  updateEntry(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBlacklistEntryDto,
  ) {
    return this.adminSafetyService.updateEntry(id, dto);
  }

  /**
   * Soft-disable a BlacklistEntry by ID (`isActive = false`).
   * Returns `204 No Content`; throws 404 if not found.
   */
  @Delete('blacklist/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  disableEntry(@Param('id', ParseIntPipe) id: number) {
    return this.adminSafetyService.disableEntry(id);
  }
}
