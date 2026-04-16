import { Module } from '@nestjs/common';
import { PostgresRetrievalService } from './services/postgres-retrieval.service';
import { RETRIEVAL_SERVICE } from './interfaces/retrieval-service.interface';

/**
 * RetrievalModule — provides the IRetrievalService DI binding.
 *
 * Currently binds to `PostgresRetrievalService` (pg_trgm / ILIKE).
 * A future vector-search implementation (pgvector, Pinecone, …) only needs to
 * implement `IRetrievalService` and update the binding here.
 */
@Module({
  providers: [
    PostgresRetrievalService,
    {
      provide: RETRIEVAL_SERVICE,
      useExisting: PostgresRetrievalService,
    },
  ],
  exports: [RETRIEVAL_SERVICE],
})
export class RetrievalModule {}
