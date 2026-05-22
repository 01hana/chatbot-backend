import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * CreateFeedbackDto — payload for POST /chat/sessions/:sessionToken/messages/:messageId/feedback
 *
 * Only up/down (thumbs) values are supported — no numeric rating scale.
 */
export class CreateFeedbackDto {
  /** Thumbs-up or thumbs-down value. */
  @IsIn(['up', 'down'])
  value!: string;

  /** Optional free-text explanation from the user. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
