import { Module } from '@nestjs/common';
import { IntentModule } from '../intent/intent.module';
import { AnswerTemplateResolver } from './answer-template-resolver';

/**
 * TemplateModule — provides `AnswerTemplateResolver` for use by ChatModule.
 *
 * Imports `IntentModule` so that `AnswerTemplateResolver` can access
 * `IntentService.getCachedTemplates()` for the `rag+template` fill path.
 *
 * SystemConfigModule and PrismaModule are @Global, so they are available
 * without being listed here.
 */
@Module({
  imports: [IntentModule],
  providers: [AnswerTemplateResolver],
  exports: [AnswerTemplateResolver],
})
export class TemplateModule {}
