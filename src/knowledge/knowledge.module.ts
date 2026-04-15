import { Module } from '@nestjs/common';
import { KnowledgeRepository } from './knowledge.repository';
import { KnowledgeService } from './knowledge.service';

/**
 * KnowledgeModule — provides knowledge-entry retrieval and management.
 *
 * Exports `KnowledgeService` so that RetrievalModule (Phase 2) and admin
 * controllers (Phase 6) can consume knowledge without coupling to Prisma.
 */
@Module({
  providers: [KnowledgeRepository, KnowledgeService],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
