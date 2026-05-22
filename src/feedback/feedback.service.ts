import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Feedback } from '../generated/prisma/client';
import {
  ConversationFeedbackSummary,
  DashboardFeedbackSummary,
  FeedbackListParams,
  FeedbackRepository,
} from './feedback.repository';
import { CreateFeedbackDto } from './dto/create-feedback.dto';

/** Allowed feedback value literals. */
const VALID_VALUES = ['up', 'down'] as const;

/**
 * FeedbackService — domain logic for user feedback on assistant messages.
 *
 * submitFeedback()           — called from POST /chat/sessions/:token/messages/:id/feedback
 * getConversationSummary()   — used by admin Conversation-detail panel
 * getDashboardSummary()      — used by admin Dashboard
 * list()                     — general-purpose listing for admin / analytics
 *
 * Upsert strategy: only the LAST feedback per (messageId) is retained.
 * On every submission, existing feedback for the message is deleted first,
 * then a fresh row is created.
 */
@Injectable()
export class FeedbackService {
  constructor(private readonly feedbackRepository: FeedbackRepository) {}

  /**
   * Submit (or replace) feedback for a single assistant message.
   *
   * Errors:
   *   400 — invalid value (not up/down)
   *   404 — sessionToken not found
   *   404 — messageId not found
   *   400 — message does not belong to the session
   */
  async submitFeedback(
    sessionToken: string,
    messageId: number,
    dto: CreateFeedbackDto,
  ): Promise<Feedback> {
    if (!VALID_VALUES.includes(dto.value as 'up' | 'down')) {
      throw new BadRequestException(
        `Invalid feedback value "${dto.value}". Allowed values: up, down`,
      );
    }

    const conversation = await this.feedbackRepository.findConversationByToken(sessionToken);
    if (!conversation) {
      throw new NotFoundException('Session not found');
    }

    const message = await this.feedbackRepository.findMessageById(messageId);
    if (!message) {
      throw new NotFoundException(`Message ${messageId} not found`);
    }

    if (message.conversationId !== conversation.id) {
      throw new BadRequestException('Message does not belong to this session');
    }

    if (message.role !== 'assistant') {
      throw new BadRequestException('Feedback is only allowed for assistant messages');
    }

    // Upsert: delete any previous feedback for this message, then insert fresh
    await this.feedbackRepository.deleteByMessageId(messageId);
    return this.feedbackRepository.createFeedback({
      conversationId: conversation.id,
      messageId,
      value: dto.value as 'up' | 'down',
      reason: dto.reason ?? null,
    });
  }

  /**
   * Return feedback summary for a single conversation.
   * Provides totalCount, upCount, downCount, and reason breakdown.
   */
  async getConversationSummary(
    conversationId: number,
  ): Promise<ConversationFeedbackSummary> {
    return this.feedbackRepository.summaryByConversation(conversationId);
  }

  /**
   * Return global feedback dashboard summary.
   * Optionally scoped to a date range.
   */
  async getDashboardSummary(
    dateRange?: { from?: Date; to?: Date },
  ): Promise<DashboardFeedbackSummary> {
    return this.feedbackRepository.dashboardSummary(dateRange);
  }

  /**
   * Paginated list of feedback rows for admin / analytics use.
   */
  async list(
    params: FeedbackListParams,
  ): Promise<{ items: Feedback[]; total: number }> {
    return this.feedbackRepository.list(params);
  }
}
