import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * DTO for `POST /api/v1/chat/sessions`.
 * All fields are optional — the server generates sessionToken automatically.
 */
export class CreateSessionDto {
  /**
   * Preferred language for the session: "zh-TW" | "en".
   * Defaults to "zh-TW" when not provided.
   */
  @IsOptional()
  @IsString()
  language?: string;
}

/**
 * DTO for `POST /api/v1/chat/sessions/:sessionToken/messages`.
 */
export class SendMessageDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(2000)
  message!: string;
}

/**
 * DTO for `POST /api/v1/chat/sessions/:sessionToken/handoff`.
 * Allows the frontend to explicitly request a human hand-off.
 */
export class HandoffDto {
  /** Optional visitor-provided reason / summary for the handoff. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
