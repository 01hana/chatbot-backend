import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { IntentTemplate } from '../../generated/prisma/client';
import { CreateIntentTemplateDto, UpdateIntentTemplateDto } from './dto/intent-admin.dto';
import { AdminIntentService } from './admin-intent.service';

/**
 * AdminIntentController — CRUD routes for /api/v1/admin/intent.
 *
 * DELETE disables the template (sets isActive=false) rather than physically
 * deleting it, preserving the audit trail.
 *
 * Note: Auth / RBAC is explicitly deferred per spec.md v1.6.0.
 */
@Controller('admin/intent')
export class AdminIntentController {
  constructor(private readonly adminIntentService: AdminIntentService) {}

  /** List all intent templates ordered by priority (desc). */
  @Get()
  listAll(): Promise<IntentTemplate[]> {
    return this.adminIntentService.listAll();
  }

  /** Get a single intent template by id. */
  @Get(':id')
  getOne(@Param('id', ParseIntPipe) id: number): Promise<IntentTemplate> {
    return this.adminIntentService.getOne(id);
  }

  /** Create a new intent template. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateIntentTemplateDto): Promise<IntentTemplate> {
    return this.adminIntentService.create(dto);
  }

  /** Partially update an intent template. */
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateIntentTemplateDto,
  ): Promise<IntentTemplate> {
    return this.adminIntentService.update(id, dto);
  }

  /** Disable an intent template (sets isActive=false; does not delete). */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  disable(@Param('id', ParseIntPipe) id: number): Promise<IntentTemplate> {
    return this.adminIntentService.disable(id);
  }

  /** Manually trigger an IntentService cache reload. */
  @Post('cache/invalidate')
  @HttpCode(HttpStatus.NO_CONTENT)
  invalidateCache(): Promise<void> {
    return this.adminIntentService.invalidateCacheManual();
  }
}
