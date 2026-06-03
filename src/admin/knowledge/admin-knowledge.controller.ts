import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { KnowledgeEntry, KnowledgeVersion } from '../../generated/prisma/client';
import { CreateKnowledgeDto, UpdateKnowledgeDto, ListKnowledgeQueryDto } from './dto/knowledge-admin.dto';
import { AdminKnowledgeService } from './admin-knowledge.service';

/**
 * AdminKnowledgeController — CRUD + publishing routes for /api/v1/admin/knowledge.
 *
 * Note: Auth / RBAC is explicitly deferred per spec.md v1.6.0.
 */
@Controller('admin/knowledge')
export class AdminKnowledgeController {
  constructor(private readonly adminKnowledgeService: AdminKnowledgeService) {}

  /** List knowledge entries with pagination and optional filters. */
  @Get()
  list(
    @Query() query: ListKnowledgeQueryDto,
  ): Promise<{ data: KnowledgeEntry[]; meta: { total: number; page: number; pageSize: number } }> {
    return this.adminKnowledgeService.list(query);
  }

  /** Get a single knowledge entry with its version history. */
  @Get(':id')
  getOne(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<KnowledgeEntry & { versions: KnowledgeVersion[] }> {
    return this.adminKnowledgeService.getOneWithVersions(id);
  }

  /** Create a new knowledge entry (status defaults to draft, visibility defaults to private). */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateKnowledgeDto): Promise<KnowledgeEntry> {
    return this.adminKnowledgeService.create(dto);
  }

  /**
   * Update an existing knowledge entry.
   * Snapshots current content to KnowledgeVersion, increments version, resets status to draft.
   */
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateKnowledgeDto,
  ): Promise<KnowledgeEntry> {
    return this.adminKnowledgeService.update(id, dto);
  }

  /** Soft-delete a knowledge entry. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.adminKnowledgeService.remove(id);
  }

  /**
   * Publish a knowledge entry (draft/archived → published).
   * published → no-op.
   */
  @Post(':id/publish')
  publish(@Param('id', ParseIntPipe) id: number): Promise<KnowledgeEntry> {
    return this.adminKnowledgeService.publish(id);
  }

  /**
   * Archive a knowledge entry (any → archived).
   * archived → no-op.
   */
  @Post(':id/archive')
  archive(@Param('id', ParseIntPipe) id: number): Promise<KnowledgeEntry> {
    return this.adminKnowledgeService.archive(id);
  }
}
