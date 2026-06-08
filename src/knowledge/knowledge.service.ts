import { Injectable } from '@nestjs/common';
import { KnowledgeEntry, KnowledgeVersion } from '../generated/prisma/client';
import { KnowledgeRepository, KnowledgeListParams } from './knowledge.repository';
import { RetrievalQuery } from './types/retrieval-query.type';

/**
 * KnowledgeService — application-layer façade over KnowledgeRepository.
 *
 * All callers (chat pipeline, admin controllers) must use this service and
 * must NOT inject KnowledgeRepository directly. This ensures the security
 * invariants of `findForRetrieval()` are always honoured.
 */
@Injectable()
export class KnowledgeService {
  constructor(private readonly knowledgeRepository: KnowledgeRepository) {}

  /**
   * Return knowledge entries eligible for RAG retrieval.
   * The repository enforces `status='published'` and `visibility='public'`.
   */
  async findForRetrieval(query: RetrievalQuery = {}): Promise<KnowledgeEntry[]> {
    return this.knowledgeRepository.findForRetrieval(query);
  }

  /**
   * Find a knowledge entry by ID.
   * Returns null when not found.
   */
  async findById(id: number): Promise<KnowledgeEntry | null> {
    return this.knowledgeRepository.findById(id);
  }

  /**
   * Return all non-deleted knowledge entries regardless of status or visibility.
   * Intended for admin use only — do NOT expose this via public-facing endpoints.
   */
  async findAll(): Promise<KnowledgeEntry[]> {
    return this.knowledgeRepository.findAll();
  }

  /**
   * Create a new knowledge entry (default status = draft).
   */
  async create(
    data: Omit<
      KnowledgeEntry,
      'id' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'versions' | 'structuredAttributes'
    >,
  ): Promise<KnowledgeEntry> {
    return this.knowledgeRepository.create(data);
  }

  /**
   * Update mutable fields of an existing knowledge entry.
   */
  async update(
    id: number,
    data: Partial<
      Pick<
        KnowledgeEntry,
        | 'title'
        | 'content'
        | 'intentLabel'
        | 'tags'
        | 'aliases'
        | 'language'
        | 'status'
        | 'visibility'
        | 'sourceKey'
        | 'category'
        | 'answerType'
        | 'templateKey'
        | 'faqQuestions'
        | 'crossLanguageGroupKey'
      >
    >,
  ): Promise<KnowledgeEntry | null> {
    return this.knowledgeRepository.update(id, data);
  }

  /**
   * Soft-delete a knowledge entry.
   * Returns true when successfully deleted; false when entry not found.
   */
  async softDelete(id: number): Promise<boolean> {
    return this.knowledgeRepository.softDelete(id);
  }

  /**
   * Find all non-deleted knowledge entries belonging to a given category.
   */
  async findByCategory(category: string): Promise<KnowledgeEntry[]> {
    return this.knowledgeRepository.findByCategory(category);
  }

  /**
   * Return distinct non-empty category values for admin table filters.
   */
  async findDistinctCategories(): Promise<string[]> {
    return this.knowledgeRepository.findDistinctCategories();
  }

  /**
   * Paginated, filtered list of non-deleted entries for the admin panel.
   */
  async findFiltered(
    params: KnowledgeListParams,
  ): Promise<{ items: KnowledgeEntry[]; total: number }> {
    return this.knowledgeRepository.findFiltered(params);
  }

  /**
   * Find a single entry by ID including its version history.
   * Returns null when not found.
   */
  async findByIdWithVersions(
    id: number,
  ): Promise<(KnowledgeEntry & { versions: KnowledgeVersion[] }) | null> {
    return this.knowledgeRepository.findByIdWithVersions(id);
  }

  /**
   * Create an immutable version snapshot for a knowledge entry.
   */
  async createVersion(data: {
    knowledgeEntryId: number;
    versionNumber: number;
    contentSnapshot: string;
  }): Promise<KnowledgeVersion> {
    return this.knowledgeRepository.createVersion(data);
  }

  /**
   * Update a knowledge entry, snapshot current content as a new version,
   * increment the version counter, and reset status to 'draft'.
   * Returns null when the entry does not exist.
   */
  async updateWithVersionSnapshot(
    id: number,
    data: Partial<
      Pick<
        KnowledgeEntry,
        | 'title'
        | 'content'
        | 'intentLabel'
        | 'tags'
        | 'aliases'
        | 'language'
        | 'visibility'
        | 'sourceKey'
        | 'category'
        | 'answerType'
        | 'templateKey'
        | 'faqQuestions'
        | 'crossLanguageGroupKey'
      >
    >,
  ): Promise<KnowledgeEntry | null> {
    return this.knowledgeRepository.updateWithVersionSnapshot(id, data);
  }
}
