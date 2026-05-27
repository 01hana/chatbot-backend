import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

const SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'status',
  'language',
  'type',
] as const;

/**
 * Query parameters for GET /api/v1/admin/conversations.
 * All fields optional — defaults: page=1, pageSize=20, sortBy=createdAt desc.
 */
export class ListConversationsQueryDto {
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

  /** Full-text search across session_token, sessionId, and message content. */
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  /** Filter by intent label (currently a no-op — no schema field). */
  @IsOptional()
  @IsString()
  intentLabel?: string;

  /** true → only conversations with at least one feedback; false → none. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  hasFeedback?: boolean;

  /** true → only confidential/high-risk conversations. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  hasConfidential?: boolean;

  /** true → only sessions where a prompt-injection event was logged. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  hasPromptInjection?: boolean;

  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
