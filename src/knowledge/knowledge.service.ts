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
   * Create a new knowledge entry (default status = draft).
   */
  async create(
    data: Omit<KnowledgeEntry, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'versions'>,
  ): Promise<KnowledgeEntry> {
    return this.knowledgeRepository.create(data);
  }

  /**
   * Update mutable fields of an existing knowledge entry.
   */
  async update(
    id: number,
    data: Partial<Pick<KnowledgeEntry, 'title' | 'content' | 'intentLabel' | 'tags' | 'status' | 'visibility'>>,
  ): Promise<KnowledgeEntry | null> {
    return this.knowledgeRepository.update(id, data);
  }
}
