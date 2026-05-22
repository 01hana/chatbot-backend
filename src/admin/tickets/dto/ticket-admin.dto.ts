import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

// ─── List Query ───────────────────────────────────────────────────────────────

const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;
const TICKET_PRIORITIES = ['low', 'medium', 'high'] as const;
const SORT_FIELDS = ['createdAt', 'updatedAt', 'status', 'priority'] as const;

/**
 * Query parameters for GET /admin/tickets.
 * All fields are optional — defaults: page=1, pageSize=20, sortBy=createdAt, sortOrder=desc.
 */
export class ListTicketsQueryDto {
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
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsIn(TICKET_STATUSES)
  status?: string;

  @IsOptional()
  @IsIn(TICKET_PRIORITIES)
  priority?: string;

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
  sortOrder?: string;
}

// ─── Status Update ────────────────────────────────────────────────────────────

/**
 * Payload for PATCH /admin/tickets/:id/status.
 */
export class UpdateTicketStatusDto {
  @IsNotEmpty()
  @IsString()
  @IsIn(TICKET_STATUSES, {
    message: `status must be one of: ${TICKET_STATUSES.join(', ')}`,
  })
  status!: string;
}

// ─── Add Note ─────────────────────────────────────────────────────────────────

/**
 * Payload for POST /admin/tickets/:id/notes.
 * `content` is required and must not be blank or whitespace-only.
 */
export class AddTicketNoteDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsNotEmpty({ message: 'content is required and must not be blank' })
  @IsString()
  @Matches(/\S/, { message: 'content must not be whitespace only' })
  content!: string;
}
