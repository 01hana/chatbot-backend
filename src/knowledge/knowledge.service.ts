import { Injectable } from '@nestjs/common';
import { KnowledgeEntry } from '../generated/prisma/client';
import { KnowledgeRepository } from './knowledge.repository';
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
   * The repository enforces `status='approved'` and `visibility='public'`.
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
    data: Omit<KnowledgeEntry, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'versions' | 'structuredAttributes'>,
  ): Promise<KnowledgeEntry> {
    return this.knowledgeRepository.create(data);
  }

  /**
   * Update mutable fields of an existing knowledge entry.
   */
  async update(
    id: number,
    data: Partial<Pick<KnowledgeEntry, 'title' | 'content' | 'intentLabel' | 'tags' | 'aliases' | 'language' | 'status' | 'visibility' | 'sourceKey' | 'category' | 'answerType' | 'templateKey' | 'faqQuestions' | 'crossLanguageGroupKey'>>,
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
}
