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
import type { GlossaryTerm } from '../../generated/prisma/client';
import { CreateGlossaryTermDto, UpdateGlossaryTermDto } from './dto/glossary-admin.dto';
import { AdminGlossaryService } from './admin-glossary.service';

/**
 * AdminGlossaryController — CRUD routes for /api/v1/admin/glossary.
 *
 * DELETE physically removes the glossary term and immediately invalidates
 * the IntentService synonym-expansion cache.
 *
 * Note: Auth / RBAC is explicitly deferred per spec.md v1.6.0.
 */
@Controller('admin/glossary')
export class AdminGlossaryController {
  constructor(private readonly adminGlossaryService: AdminGlossaryService) {}

  /** List all glossary terms ordered by id. */
  @Get()
  listAll(): Promise<GlossaryTerm[]> {
    return this.adminGlossaryService.listAll();
  }

  /** Get a single glossary term by id. */
  @Get(':id')
  getOne(@Param('id', ParseIntPipe) id: number): Promise<GlossaryTerm> {
    return this.adminGlossaryService.getOne(id);
  }

  /** Create a new glossary term. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateGlossaryTermDto): Promise<GlossaryTerm> {
    return this.adminGlossaryService.create(dto);
  }

  /** Partially update a glossary term (synonyms and/or intentLabel). */
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateGlossaryTermDto,
  ): Promise<GlossaryTerm> {
    return this.adminGlossaryService.update(id, dto);
  }

  /** Permanently delete a glossary term. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.adminGlossaryService.remove(id);
  }

  /** Manually trigger an IntentService cache reload. */
  @Post('cache/invalidate')
  @HttpCode(HttpStatus.NO_CONTENT)
  invalidateCache(): Promise<void> {
    return this.adminGlossaryService.invalidateCacheManual();
  }
}
