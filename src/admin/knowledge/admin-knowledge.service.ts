import { Injectable, NotFoundException } from '@nestjs/common';
import { KnowledgeEntry } from '../../generated/prisma/client';
import { KnowledgeService } from '../../knowledge/knowledge.service';
import { CreateKnowledgeDto, UpdateKnowledgeDto } from './dto/knowledge-admin.dto';

/**
 * AdminKnowledgeService — admin CRUD for knowledge entries.
 *
 * Delegates to KnowledgeService (which delegates to KnowledgeRepository).
 * All DB access is strictly through the service layer — no direct Prisma calls here.
 *
 * Note: Auth / RBAC is explicitly deferred per spec.md v1.6.0.
 */
@Injectable()
export class AdminKnowledgeService {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  /** List all non-deleted knowledge entries (all statuses and visibilities). */
  async listAll(): Promise<KnowledgeEntry[]> {
    return this.knowledgeService.findAll();
  }

  /** Get a single knowledge entry by ID; throws 404 when not found. */
  async getOne(id: number): Promise<KnowledgeEntry> {
    const entry = await this.knowledgeService.findById(id);
    if (!entry) {
      throw new NotFoundException(`Knowledge entry #${id} not found`);
    }
    return entry;
  }

  /**
   * Create a new knowledge entry.
   * Defaults: status='draft', visibility='private', language='zh-TW'.
   */
  async create(dto: CreateKnowledgeDto): Promise<KnowledgeEntry> {
    return this.knowledgeService.create({
      title: dto.title,
      content: dto.content,
      intentLabel: dto.intentLabel ?? null,
      tags: dto.tags ?? [],
      aliases: dto.aliases ?? [],
      language: dto.language ?? 'zh-TW',
      status: 'draft',
      visibility: 'private',
      version: 1,
      sourceKey: dto.sourceKey ?? null,
      category: dto.category ?? null,
      answerType: dto.answerType ?? 'rag',
      templateKey: dto.templateKey ?? null,
      faqQuestions: dto.faqQuestions ?? [],
      crossLanguageGroupKey: dto.crossLanguageGroupKey ?? null,
    });
  }

  /**
   * Update mutable fields of an existing knowledge entry.
   * Only the provided fields are updated (partial update).
   * Throws 404 when not found.
   */
  async update(id: number, dto: UpdateKnowledgeDto): Promise<KnowledgeEntry> {
    const patch: Parameters<KnowledgeService['update']>[1] = {};
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.content !== undefined) patch.content = dto.content;
    if (dto.intentLabel !== undefined) patch.intentLabel = dto.intentLabel;
    if (dto.tags !== undefined) patch.tags = dto.tags;
    if (dto.aliases !== undefined) patch.aliases = dto.aliases;
    if (dto.language !== undefined) patch.language = dto.language;
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.visibility !== undefined) patch.visibility = dto.visibility;
    if (dto.sourceKey !== undefined) patch.sourceKey = dto.sourceKey;
    if (dto.category !== undefined) patch.category = dto.category;
    if (dto.answerType !== undefined) patch.answerType = dto.answerType;
    if (dto.templateKey !== undefined) patch.templateKey = dto.templateKey;
    if (dto.faqQuestions !== undefined) patch.faqQuestions = dto.faqQuestions;
    if (dto.crossLanguageGroupKey !== undefined) patch.crossLanguageGroupKey = dto.crossLanguageGroupKey;

    const entry = await this.knowledgeService.update(id, patch);
    if (!entry) {
      throw new NotFoundException(`Knowledge entry #${id} not found`);
    }
    return entry;
  }

  /**
   * Soft-delete a knowledge entry.
   * Throws 404 when not found.
   */
  async remove(id: number): Promise<void> {
    const deleted = await this.knowledgeService.softDelete(id);
    if (!deleted) {
      throw new NotFoundException(`Knowledge entry #${id} not found`);
    }
  }

  /**
   * Find all knowledge entries belonging to a given category.
   */
  async findByCategory(category: string): Promise<KnowledgeEntry[]> {
    return this.knowledgeService.findByCategory(category);
  }
}
