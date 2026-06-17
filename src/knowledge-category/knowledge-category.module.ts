import { Module } from '@nestjs/common';
import { IntentModule } from '../intent/intent.module';
import { KnowledgeCategoryRepository } from './knowledge-category.repository';
import { KnowledgeCategoryService } from './knowledge-category.service';

@Module({
  imports: [IntentModule],
  providers: [KnowledgeCategoryRepository, KnowledgeCategoryService],
  exports: [KnowledgeCategoryService],
})
export class KnowledgeCategoryModule {}
