import { IsIn, IsOptional, IsString } from 'class-validator';

const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'closed'] as const;

/**
 * Payload for PATCH /api/v1/admin/leads/:id.
 *
 * All fields are optional. Provide only what you want to change.
 *  - `note`    → appended (newline-delimited) to the existing notes field.
 *  - `status`  → must be a valid LeadStatus value when provided.
 */
export class UpdateLeadDto {
  @IsOptional()
  @IsIn(LEAD_STATUSES, { message: 'status must be one of: new, contacted, qualified, closed' })
  status?: string;

  /** Freetext note — appended to existing notes (newline-delimited). */
  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  company?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  message?: string;
}
