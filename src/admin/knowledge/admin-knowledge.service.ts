import { Injectable, NotFoundException } from '@nestjs/common';
import { KnowledgeEntry } from '../../generated/prisma/client';
import { KnowledgeClassificationService } from '../../knowledge/knowledge-classification.service';
import { KnowledgeCategoryService } from '../../knowledge-category/knowledge-category.service';
import { KnowledgeCategoryOptionVm } from '../../knowledge-category/knowledge-category.repository';
import { KnowledgeService } from '../../knowledge/knowledge.service';
import { KnowledgeListParams } from '../../knowledge/knowledge.repository';
import { AuditService } from '../../audit/audit.service';
import {
  CreateKnowledgeDto,
  UpdateKnowledgeDto,
  UpdateKnowledgeVisibilityDto,
  ListKnowledgeQueryDto,
  KnowledgeFilterOptionsResponse,
  KnowledgeStatus,
  AdminKnowledgeEntryVm,
  AdminKnowledgeEntryDetailVm,
  KnowledgeRetrievalState,
  RetrievalBlockReason,
  KNOWLEDGE_STATUSES,
} from './dto/knowledge-admin.dto';

const KNOWLEDGE_STATUS_LABELS: Record<KnowledgeStatus, string> = {
  draft: '草稿',
  published: '已發佈',
  archived: '已封存',
};

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
    private readonly knowledgeClassificationService: KnowledgeClassificationService,
    private readonly knowledgeCategoryService: KnowledgeCategoryService,
  ) {}

  // ─── List (paginated + filtered) ──────────────────────────────────────────

  /**
   * Paginated, filtered list of all non-deleted knowledge entries.
   */
  async list(query: ListKnowledgeQueryDto): Promise<{
    data: AdminKnowledgeEntryVm[];
    meta: { total: number; page: number; pageSize: number };
  }> {
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
    return {
      data: items.map(item => this.toAdminKnowledgeEntryVm(item)),
      meta: { total, page, pageSize },
    };
  }

  /**
   * Return filter option lists for the admin knowledge table.
   */
  async getFilters(): Promise<KnowledgeFilterOptionsResponse> {
    const categories = await this.knowledgeCategoryService.findActiveOptions();

    return {
      status: KNOWLEDGE_STATUSES.map(status => ({
        label: KNOWLEDGE_STATUS_LABELS[status],
        value: status,
      })),
      category: categories,
    };
  }

  async getCategories(): Promise<KnowledgeCategoryOptionVm[]> {
    return this.knowledgeCategoryService.findActiveOptions();
  }

  // ─── Read single ──────────────────────────────────────────────────────────

  /** Get a single knowledge entry by ID; throws 404 when not found. */
  async getOne(id: number): Promise<AdminKnowledgeEntryVm> {
    const entry = await this.knowledgeService.findById(id);
    if (!entry) {
      throw new NotFoundException(`Knowledge entry #${id} not found`);
    }
    return this.toAdminKnowledgeEntryVm(entry);
  }

  /**
   * Get a single knowledge entry with its version history.
   * Throws 404 when not found.
   */
  async getOneWithVersions(id: number): Promise<AdminKnowledgeEntryDetailVm> {
    const entry = await this.knowledgeService.findByIdWithVersions(id);
    if (!entry) {
      throw new NotFoundException(`Knowledge entry #${id} not found`);
    }
    return this.toAdminKnowledgeEntryVm(entry);
  }

  // ─── Create ───────────────────────────────────────────────────────────────

  /**
   * Create a new knowledge entry.
   * Defaults: status='draft', visibility='private' (when not provided), version=1.
   */
  async create(dto: CreateKnowledgeDto): Promise<AdminKnowledgeEntryVm> {
    const intentLabel = await this.knowledgeClassificationService.resolveIntentLabel({
      category: dto.category,
      intentLabel: dto.intentLabel,
    });
    const tags = this.knowledgeClassificationService.mergeTags(
      dto.tags,
      this.knowledgeClassificationService.suggestTags({
        title: dto.title,
        category: dto.category,
        intentLabel,
        content: dto.content,
        language: dto.language ?? 'zh-TW',
      }),
    );

    const entry = await this.knowledgeService.create({
      title: dto.title,
      content: dto.content,
      intentLabel,
      tags,
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

    return this.toAdminKnowledgeEntryVm(entry);
  }

  // ─── Update (with version snapshot) ──────────────────────────────────────

  /**
   * Update mutable fields of an existing knowledge entry.
   * Snapshots current content to KnowledgeVersion before applying changes.
   * Increments version and resets status to 'draft' after update.
   * Throws 404 when not found.
   */
  async update(id: number, dto: UpdateKnowledgeDto): Promise<AdminKnowledgeEntryVm> {
    const current = await this.knowledgeService.findById(id);
    if (!current) {
      throw new NotFoundException(`Knowledge entry #${id} not found`);
    }

    const effective = {
      title: dto.title ?? current.title,
      content: dto.content ?? current.content,
      category: dto.category ?? current.category,
      intentLabel: dto.intentLabel,
      language: dto.language ?? current.language,
    };
    const shouldResolveIntentLabel = dto.intentLabel !== undefined || dto.category !== undefined;
    const intentLabel = shouldResolveIntentLabel
      ? await this.knowledgeClassificationService.resolveIntentLabel({
          category: effective.category,
          intentLabel: effective.intentLabel,
        })
      : current.intentLabel;
    const tags = this.knowledgeClassificationService.mergeTags(
      current.tags,
      dto.tags,
      this.knowledgeClassificationService.suggestTags({
        title: effective.title,
        category: effective.category,
        intentLabel,
        content: effective.content,
        language: effective.language,
      }),
    );

    const patch: Parameters<KnowledgeService['updateWithVersionSnapshot']>[1] = {};
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.content !== undefined) patch.content = dto.content;
    patch.intentLabel = intentLabel;
    patch.tags = tags;
    if (dto.aliases !== undefined) patch.aliases = dto.aliases;
    if (dto.language !== undefined) patch.language = dto.language;
    if (dto.visibility !== undefined) patch.visibility = dto.visibility;
    if (dto.sourceKey !== undefined) patch.sourceKey = dto.sourceKey;
    if (dto.category !== undefined) patch.category = dto.category;
    if (dto.answerType !== undefined) patch.answerType = dto.answerType;
    if (dto.templateKey !== undefined) patch.templateKey = dto.templateKey;
    if (dto.faqQuestions !== undefined) patch.faqQuestions = dto.faqQuestions;
    if (dto.crossLanguageGroupKey !== undefined)
      patch.crossLanguageGroupKey = dto.crossLanguageGroupKey;

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

    return this.toAdminKnowledgeEntryVm(entry);
  }

  /**
   * Update only visibility without creating a content version snapshot.
   * Does not recalculate intentLabel/tags, modify content fields, or reset status.
   */
  async updateVisibility(
    id: number,
    dto: UpdateKnowledgeVisibilityDto,
  ): Promise<AdminKnowledgeEntryVm> {
    const current = await this.knowledgeService.findById(id);
    if (!current) {
      throw new NotFoundException(`Knowledge entry #${id} not found`);
    }

    if (current.visibility === dto.visibility) {
      return this.toAdminKnowledgeEntryVm(current);
    }

    const updated = await this.knowledgeService.update(id, { visibility: dto.visibility });
    if (!updated) {
      throw new NotFoundException(`Knowledge entry #${id} not found`);
    }

    this.auditService
      .log({
        eventType: 'knowledge_visibility_updated',
        eventData: {
          id,
          sourceKey: current.sourceKey,
          fromVisibility: current.visibility,
          toVisibility: dto.visibility,
          status: current.status,
          version: current.version,
        },
      })
      .catch(() => undefined);

    return this.toAdminKnowledgeEntryVm(updated);
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
  async publish(id: number): Promise<AdminKnowledgeEntryVm> {
    const entry = await this.knowledgeService.findById(id);
    if (!entry) {
      throw new NotFoundException(`Knowledge entry #${id} not found`);
    }
    if (entry.status === 'published') {
      return this.toAdminKnowledgeEntryVm(entry); // no-op
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

    return this.toAdminKnowledgeEntryVm(updated!);
  }

  /**
   * Archive a knowledge entry.
   *  - any status → archived (allowed: draft or published → archived)
   *  - archived   → no-op (returns current entry unchanged)
   * Throws 404 when not found.
   */
  async archive(id: number): Promise<AdminKnowledgeEntryVm> {
    const entry = await this.knowledgeService.findById(id);
    if (!entry) {
      throw new NotFoundException(`Knowledge entry #${id} not found`);
    }
    if (entry.status === 'archived') {
      return this.toAdminKnowledgeEntryVm(entry); // no-op
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

    return this.toAdminKnowledgeEntryVm(updated!);
  }

  private toAdminKnowledgeEntryVm<TEntry extends KnowledgeEntry>(
    entry: TEntry,
  ): TEntry & KnowledgeRetrievalState {
    return {
      ...entry,
      ...this.getRetrievalState(entry),
    };
  }

  private getRetrievalState(entry: KnowledgeEntry): KnowledgeRetrievalState {
    const retrievalBlockReasons: RetrievalBlockReason[] = [];

    if (entry.status !== 'published') {
      retrievalBlockReasons.push('status_not_published');
    }
    if (entry.visibility !== 'public') {
      retrievalBlockReasons.push('visibility_not_public');
    }
    if (entry.deletedAt !== null) {
      retrievalBlockReasons.push('deleted');
    }
    if (!entry.intentLabel?.trim()) {
      retrievalBlockReasons.push('intentLabel_missing');
    }
    if (!entry.tags.some(tag => tag.trim().length > 0)) {
      retrievalBlockReasons.push('tags_empty');
    }
    if (!entry.title.trim() || !entry.content.trim()) {
      retrievalBlockReasons.push('content_empty');
    }

    return {
      retrievable: retrievalBlockReasons.length === 0,
      retrievalBlockReasons,
    };
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
