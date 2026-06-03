import { Injectable, NotFoundException } from '@nestjs/common';
import { KnowledgeEntry, KnowledgeVersion } from '../../generated/prisma/client';
import { KnowledgeService } from '../../knowledge/knowledge.service';
import { KnowledgeListParams } from '../../knowledge/knowledge.repository';
import { AuditService } from '../../audit/audit.service';
import { CreateKnowledgeDto, UpdateKnowledgeDto, ListKnowledgeQueryDto } from './dto/knowledge-admin.dto';

/**
 * AdminKnowledgeService — admin CRUD + publishing workflow for knowledge entries.
 *
 * Delegates persistence to KnowledgeService (and in turn KnowledgeRepository).
 * All DB access is strictly through the service layer — no direct Prisma calls here.
 *
 * Publishing flow:
 *  - draft     → publish → published (normal path)
 *  - published → publish → published (no-op; already published)
 *  - archived  → publish → published (restore / republish)
 *  - any       → archive → archived  (always succeeds; archived→archived is no-op)
 *
 * Note: Auth / RBAC is explicitly deferred per spec.md v1.6.0.
 */
@Injectable()
export class AdminKnowledgeService {
  constructor(
    private readonly knowledgeService: KnowledgeService,
    private readonly auditService: AuditService,
  ) {}

  // ─── List (paginated + filtered) ──────────────────────────────────────────

  /**
   * Paginated, filtered list of all non-deleted knowledge entries.
   */
  async list(query: ListKnowledgeQueryDto): Promise<{ data: KnowledgeEntry[]; meta: { total: number; page: number; pageSize: number } }> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));

    const params: KnowledgeListParams = {
      page,
      pageSize,
      keyword: query.keyword,
      status: query.status,
      visibility: query.visibility,
      language: query.language,
      intentLabel: query.intentLabel,
      sourceKey: query.sourceKey,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    };

    const { items, total } = await this.knowledgeService.findFiltered(params);
    return { data: items, meta: { total, page, pageSize } };
  }

  // ─── Read single ──────────────────────────────────────────────────────────

  /** Get a single knowledge entry by ID; throws 404 when not found. */
  async getOne(id: number): Promise<KnowledgeEntry> {
    const entry = await this.knowledgeService.findById(id);
    if (!entry) {
      throw new NotFoundException(`Knowledge entry #${id} not found`);
    }
    return entry;
  }

  /**
   * Get a single knowledge entry with its version history.
   * Throws 404 when not found.
   */
  async getOneWithVersions(
    id: number,
  ): Promise<KnowledgeEntry & { versions: KnowledgeVersion[] }> {
    const entry = await this.knowledgeService.findByIdWithVersions(id);
    if (!entry) {
      throw new NotFoundException(`Knowledge entry #${id} not found`);
    }
    return entry;
  }

  // ─── Create ───────────────────────────────────────────────────────────────

  /**
   * Create a new knowledge entry.
   * Defaults: status='draft', visibility='private' (when not provided), version=1.
   */
  async create(dto: CreateKnowledgeDto): Promise<KnowledgeEntry> {
    const entry = await this.knowledgeService.create({
      title: dto.title,
      content: dto.content,
      intentLabel: dto.intentLabel ?? null,
      tags: dto.tags ?? [],
      aliases: dto.aliases ?? [],
      language: dto.language ?? 'zh-TW',
      status: 'draft',
      visibility: dto.visibility ?? 'private',
      version: 1,
      sourceKey: dto.sourceKey ?? null,
      category: dto.category ?? null,
      answerType: dto.answerType ?? 'rag',
      templateKey: dto.templateKey ?? null,
      faqQuestions: dto.faqQuestions ?? [],
      crossLanguageGroupKey: dto.crossLanguageGroupKey ?? null,
    });

    this.auditService
      .log({
        eventType: 'knowledge_created',
        eventData: { id: entry.id, sourceKey: entry.sourceKey, version: entry.version },
      })
      .catch(() => undefined);

    return entry;
  }

  // ─── Update (with version snapshot) ──────────────────────────────────────

  /**
   * Update mutable fields of an existing knowledge entry.
   * Snapshots current content to KnowledgeVersion before applying changes.
   * Increments version and resets status to 'draft' after update.
   * Throws 404 when not found.
   */
  async update(id: number, dto: UpdateKnowledgeDto): Promise<KnowledgeEntry> {
    const patch: Parameters<KnowledgeService['updateWithVersionSnapshot']>[1] = {};
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.content !== undefined) patch.content = dto.content;
    if (dto.intentLabel !== undefined) patch.intentLabel = dto.intentLabel;
    if (dto.tags !== undefined) patch.tags = dto.tags;
    if (dto.aliases !== undefined) patch.aliases = dto.aliases;
    if (dto.language !== undefined) patch.language = dto.language;
    if (dto.visibility !== undefined) patch.visibility = dto.visibility;
    if (dto.sourceKey !== undefined) patch.sourceKey = dto.sourceKey;
    if (dto.category !== undefined) patch.category = dto.category;
    if (dto.answerType !== undefined) patch.answerType = dto.answerType;
    if (dto.templateKey !== undefined) patch.templateKey = dto.templateKey;
    if (dto.faqQuestions !== undefined) patch.faqQuestions = dto.faqQuestions;
    if (dto.crossLanguageGroupKey !== undefined) patch.crossLanguageGroupKey = dto.crossLanguageGroupKey;

    const entry = await this.knowledgeService.updateWithVersionSnapshot(id, patch);
    if (!entry) {
      throw new NotFoundException(`Knowledge entry #${id} not found`);
    }

    this.auditService
      .log({
        eventType: 'knowledge_updated',
        eventData: { id: entry.id, sourceKey: entry.sourceKey, version: entry.version },
      })
      .catch(() => undefined);

    return entry;
  }

  // ─── Delete ───────────────────────────────────────────────────────────────

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

  // ─── Publishing flow ──────────────────────────────────────────────────────

  /**
   * Publish a knowledge entry (draft/archived → published).
   *  - published → no-op (returns current entry unchanged)
   * Throws 404 when not found.
   */
  async publish(id: number): Promise<KnowledgeEntry> {
    const entry = await this.knowledgeService.findById(id);
    if (!entry) {
      throw new NotFoundException(`Knowledge entry #${id} not found`);
    }
    if (entry.status === 'published') {
      return entry; // no-op
    }

    const updated = await this.knowledgeService.update(id, { status: 'published' });

    this.auditService
      .log({
        eventType: 'knowledge_published',
        eventData: {
          id,
          sourceKey: entry.sourceKey,
          fromStatus: entry.status,
          toStatus: 'published',
          version: entry.version,
        },
      })
      .catch(() => undefined);

    return updated!;
  }

  /**
   * Archive a knowledge entry.
   *  - any status → archived (allowed: draft or published → archived)
   *  - archived   → no-op (returns current entry unchanged)
   * Throws 404 when not found.
   */
  async archive(id: number): Promise<KnowledgeEntry> {
    const entry = await this.knowledgeService.findById(id);
    if (!entry) {
      throw new NotFoundException(`Knowledge entry #${id} not found`);
    }
    if (entry.status === 'archived') {
      return entry; // no-op
    }

    const updated = await this.knowledgeService.update(id, { status: 'archived' });

    this.auditService
      .log({
        eventType: 'knowledge_archived',
        eventData: {
          id,
          sourceKey: entry.sourceKey,
          fromStatus: entry.status,
          toStatus: 'archived',
          version: entry.version,
        },
      })
      .catch(() => undefined);

    return updated!;
  }

  // ─── Legacy / category ────────────────────────────────────────────────────

  /**
   * Find all knowledge entries belonging to a given category.
   */
  async findByCategory(category: string): Promise<KnowledgeEntry[]> {
    return this.knowledgeService.findByCategory(category);
  }

  /** @deprecated Use list() instead. */
  async listAll(): Promise<KnowledgeEntry[]> {
    return this.knowledgeService.findAll();
  }
}
