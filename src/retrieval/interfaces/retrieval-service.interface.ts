import { RetrievalQuery, RetrievalResult } from '../types/retrieval.types';

/**
 * IRetrievalService — provider-agnostic abstraction for knowledge retrieval.
 *
 * The default implementation uses PostgreSQL full-text search (pg_trgm or ILIKE).
 * Future implementations could swap in vector similarity (pgvector, Pinecone, etc.)
 * by implementing this interface.
 */
export interface IRetrievalService {
  /**
   * Retrieve relevant knowledge entries for the given query.
   * Results are ordered by descending similarity score.
   */
  retrieve(query: RetrievalQuery): Promise<RetrievalResult[]>;
}

/** DI injection token for IRetrievalService. */
export const RETRIEVAL_SERVICE = Symbol('RETRIEVAL_SERVICE');
