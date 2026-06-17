import { Module } from '@nestjs/common';
import { IntentModule } from '../intent/intent.module';
import { KnowledgeCategoryModule } from '../knowledge-category/knowledge-category.module';
import { KnowledgeClassificationService } from './knowledge-classification.service';
import { KnowledgeRepository } from './knowledge.repository';
import { KnowledgeService } from './knowledge.service';

/**
 * KnowledgeModule — provides knowledge-entry retrieval and management.
 *
 * Exports `KnowledgeService` so that RetrievalModule (Phase 2) and admin
 * controllers (Phase 6) can consume knowledge without coupling to Prisma.
 */
@Module({
  imports: [IntentModule, KnowledgeCategoryModule],
  providers: [KnowledgeRepository, KnowledgeService, KnowledgeClassificationService],
  exports: [KnowledgeService, KnowledgeClassificationService],
})
export class KnowledgeModule {}
