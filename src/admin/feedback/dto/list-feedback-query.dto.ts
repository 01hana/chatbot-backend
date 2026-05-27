import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

const SORT_FIELDS = ['createdAt', 'value'] as const;

/**
 * Query parameters for GET /api/v1/admin/feedback.
 * All fields optional — defaults: page=1, pageSize=20, sortBy=createdAt desc.
 *
 * NOTE: `value` is strictly up | down — no numeric rating.
 */
export class ListFeedbackQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  conversationId?: number;

  /** Filter by Conversation.sessionId (internal UUID). */
  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  messageId?: number;

  /** up | down only — no numeric rating. */
  @IsOptional()
  @IsIn(['up', 'down'])
  value?: 'up' | 'down';

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
