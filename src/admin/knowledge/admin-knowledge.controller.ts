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
import {
  CreateKnowledgeDto,
  UpdateKnowledgeDto,
  UpdateKnowledgeVisibilityDto,
  ListKnowledgeQueryDto,
  KnowledgeFilterOptionsResponse,
  AdminKnowledgeEntryVm,
  AdminKnowledgeEntryDetailVm,
} from './dto/knowledge-admin.dto';
import {
  KnowledgeCategoryOptionVm,
  KnowledgeCategoryVm,
} from '../../knowledge-category/knowledge-category.repository';
import {
  CreateKnowledgeCategoryDto,
  UpdateKnowledgeCategoryDto,
} from '../../knowledge-category/dto/knowledge-category.dto';
import { KnowledgeCategoryService } from '../../knowledge-category/knowledge-category.service';
import { AdminKnowledgeService } from './admin-knowledge.service';

/**
 * AdminKnowledgeController — CRUD + publishing routes for /api/v1/admin/knowledge.
 *
 * Note: Auth / RBAC is explicitly deferred per spec.md v1.6.0.
 */
@Controller('admin/knowledge')
export class AdminKnowledgeController {
  constructor(
    private readonly adminKnowledgeService: AdminKnowledgeService,
    private readonly knowledgeCategoryService: KnowledgeCategoryService,
  ) {}

  /** List knowledge entries with pagination and optional filters. */
  @Get()
  list(@Query() query: ListKnowledgeQueryDto): Promise<{
    data: AdminKnowledgeEntryVm[];
    meta: { total: number; page: number; pageSize: number };
  }> {
    return this.adminKnowledgeService.list(query);
  }

  /** Get filter options for the knowledge table. */
  @Get('filters')
  getFilters(): Promise<KnowledgeFilterOptionsResponse> {
    return this.adminKnowledgeService.getFilters();
  }

  /** Get active category options for the knowledge form/table. */
  @Get('categories')
  getCategories(): Promise<KnowledgeCategoryOptionVm[]> {
    return this.adminKnowledgeService.getCategories();
  }

  /** Create a knowledge category. */
  @Post('categories')
  @HttpCode(HttpStatus.CREATED)
  createCategory(@Body() dto: CreateKnowledgeCategoryDto): Promise<KnowledgeCategoryVm> {
    return this.knowledgeCategoryService.create(dto);
  }

  /** Update a knowledge category by key. */
  @Patch('categories/:key')
  updateCategory(
    @Param('key') key: string,
    @Body() dto: UpdateKnowledgeCategoryDto,
  ): Promise<KnowledgeCategoryVm> {
    return this.knowledgeCategoryService.update(key, dto);
  }

  /** Soft-delete a knowledge category by key. */
  @Delete('categories/:key')
  async deleteCategory(@Param('key') key: string): Promise<KnowledgeCategoryVm> {
    return this.knowledgeCategoryService.softDelete(key);
  }

  /** Get a single knowledge entry with its version history. */
  @Get(':id')
  getOne(@Param('id', ParseIntPipe) id: number): Promise<AdminKnowledgeEntryDetailVm> {
    return this.adminKnowledgeService.getOneWithVersions(id);
  }

  /** Create a new knowledge entry (status defaults to draft, visibility defaults to private). */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateKnowledgeDto): Promise<AdminKnowledgeEntryVm> {
    return this.adminKnowledgeService.create(dto);
  }

  /** Update only visibility without creating a version snapshot. */
  @Patch(':id/visibility')
  updateVisibility(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateKnowledgeVisibilityDto,
  ): Promise<AdminKnowledgeEntryVm> {
    return this.adminKnowledgeService.updateVisibility(id, dto);
  }

  /**
   * Update an existing knowledge entry.
   * Snapshots current content to KnowledgeVersion, increments version, resets status to draft.
   */
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateKnowledgeDto,
  ): Promise<AdminKnowledgeEntryVm> {
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
  publish(@Param('id', ParseIntPipe) id: number): Promise<AdminKnowledgeEntryVm> {
    return this.adminKnowledgeService.publish(id);
  }

  /**
   * Archive a knowledge entry (any → archived).
   * archived → no-op.
   */
  @Post(':id/archive')
  archive(@Param('id', ParseIntPipe) id: number): Promise<AdminKnowledgeEntryVm> {
    return this.adminKnowledgeService.archive(id);
  }
}
