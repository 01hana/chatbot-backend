import { IsIn, IsNotEmpty } from 'class-validator';

/**
 * Payload for PATCH /api/v1/admin/leads/:id/status.
 * Validates that status is a recognised LeadStatus value.
 */
export class UpdateLeadStatusDto {
  @IsNotEmpty()
  @IsIn(['new', 'contacted', 'qualified', 'closed'], {
    message: 'status must be one of: new, contacted, qualified, closed',
  })
  status!: string;
}
