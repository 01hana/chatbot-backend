import { PartialType } from '@nestjs/mapped-types';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { CreateLeadDto } from './create-lead.dto';

/**
 * DTO for admin-side Lead updates.
 * All CreateLeadDto fields become optional, plus admin-only fields.
 */
export class UpdateLeadDto extends PartialType(CreateLeadDto) {
  /** Admin workflow status: new | contacted | qualified | closed. */
  @IsOptional()
  @IsString()
  @IsIn(['new', 'contacted', 'qualified', 'closed'])
  status?: string;

  /** Admin freetext notes / remarks. */
  @IsOptional()
  @IsString()
  notes?: string;
}
