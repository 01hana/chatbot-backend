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
import { CreateKnowledgeDto, UpdateKnowledgeDto } from './dto/knowledge-admin.dto';
import { AdminKnowledgeService } from './admin-knowledge.service';

/**
 * AdminKnowledgeController — skeleton routes for /api/v1/admin/knowledge.
 *
 * Phase 1 status: All endpoints return 501 Not Implemented.
 * Phase 6 (T6-xxx) will fill in the real service logic, validation, and
 * version-management integration.
 *
 * Note: Auth / RBAC is explicitly deferred per spec.md v1.6.0.
 */
@Controller('admin/knowledge')
export class AdminKnowledgeController {
  constructor(private readonly adminKnowledgeService: AdminKnowledgeService) {}

  /** List all knowledge entries (with pagination in Phase 6). */
  @Get()
  listAll(): never {
    return this.adminKnowledgeService.listAll();
  }

  /** Get a single knowledge entry by ID. */
  @Get(':id')
  getOne(@Param('id', ParseIntPipe) id: number): never {
    return this.adminKnowledgeService.getOne(id);
  }

  /** Create a new knowledge entry (status defaults to draft). */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateKnowledgeDto): never {
    return this.adminKnowledgeService.create(dto);
  }

  /** Update an existing knowledge entry. */
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateKnowledgeDto,
  ): never {
    return this.adminKnowledgeService.update(id, dto);
  }

  /** Soft-delete a knowledge entry. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIntPipe) id: number): never {
    return this.adminKnowledgeService.remove(id);
  }
}
