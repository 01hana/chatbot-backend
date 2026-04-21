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
import { KnowledgeEntry } from '../../generated/prisma/client';
import { CreateKnowledgeDto, UpdateKnowledgeDto } from './dto/knowledge-admin.dto';
import { AdminKnowledgeService } from './admin-knowledge.service';

/**
 * AdminKnowledgeController — CRUD routes for /api/v1/admin/knowledge.
 *
 * Note: Auth / RBAC is explicitly deferred per spec.md v1.6.0.
 */
@Controller('admin/knowledge')
export class AdminKnowledgeController {
  constructor(private readonly adminKnowledgeService: AdminKnowledgeService) {}

  /** List all knowledge entries (all statuses and visibilities). */
  @Get()
  listAll(): Promise<KnowledgeEntry[]> {
    return this.adminKnowledgeService.listAll();
  }

  /** Get a single knowledge entry by ID. */
  @Get(':id')
  getOne(@Param('id', ParseIntPipe) id: number): Promise<KnowledgeEntry> {
    return this.adminKnowledgeService.getOne(id);
  }

  /** Create a new knowledge entry (status defaults to draft, visibility to private). */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateKnowledgeDto): Promise<KnowledgeEntry> {
    return this.adminKnowledgeService.create(dto);
  }

  /** Update an existing knowledge entry (partial update). */
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
}
