import { Module } from '@nestjs/common';
import { FeedbackAdminController } from './feedback-admin.controller';
import { FeedbackAdminService } from './feedback-admin.service';

/**
 * FeedbackAdminModule — admin read API for the feedbacks table.
 *
 * PrismaModule is @Global so PrismaService is available without an explicit
 * import. Does NOT re-export FeedbackService — keeps admin read path separate
 * from the user-facing feedback submission path.
 */
@Module({
  controllers: [FeedbackAdminController],
  providers: [FeedbackAdminService],
})
export class FeedbackAdminModule {}
