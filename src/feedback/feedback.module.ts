import { Module } from '@nestjs/common';
import { FeedbackRepository } from './feedback.repository';
import { FeedbackService } from './feedback.service';

/**
 * FeedbackModule — provides FeedbackService and FeedbackRepository.
 *
 * PrismaModule is @Global so PrismaService is available without an explicit import.
 *
 * Exported providers:
 *   FeedbackService — used by ChatController for the feedback endpoint
 */
@Module({
  providers: [FeedbackRepository, FeedbackService],
  exports: [FeedbackService],
})
export class FeedbackModule {}
