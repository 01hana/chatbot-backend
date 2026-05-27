import { Module } from '@nestjs/common';
import { ConversationsAdminController } from './conversations-admin.controller';
import { ConversationsAdminService } from './conversations-admin.service';
import { FeedbackModule } from '../../feedback/feedback.module';

/**
 * ConversationsAdminModule — admin read/query API for Conversation data.
 *
 * Imports FeedbackModule to use FeedbackService.getConversationSummary()
 * in the detail endpoint.
 * PrismaModule is @Global so PrismaService is available without an explicit
 * import.
 */
@Module({
  imports: [FeedbackModule],
  controllers: [ConversationsAdminController],
  providers: [ConversationsAdminService],
})
export class ConversationsAdminModule {}
