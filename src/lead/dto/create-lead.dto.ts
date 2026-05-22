import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * DTO for `POST /api/v1/chat/sessions/:sessionToken/lead`.
 *
 * Required: name, email (validated format).
 * Optional: company, phone, message, language.
 *
 * Field `message` is the visitor's free-text inquiry — intentionally named
 * `message` (not `notes` / `inquiry`).
 */
export class CreateLeadDto {
  /** Visitor name — required. */
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  name!: string;

  /** Visitor email — required, must be valid email format. */
  @IsNotEmpty()
  @IsEmail()
  @MaxLength(320)
  email!: string;

  /** Visitor company name — optional. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  company?: string;

  /** Visitor phone number — optional. */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  /** Visitor's original message / inquiry — optional. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  /** Frontend language at time of submission: zh-TW | en. */
  @IsOptional()
  @IsString()
  @IsIn(['zh-TW', 'en'])
  language?: string;
}
