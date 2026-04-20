import {
  IsString,
  IsNotEmpty,
  IsBoolean,
  IsOptional,
} from 'class-validator';

// ── SafetyRule DTOs ────────────────────────────────────────────────────────

/**
 * DTO for creating a new SafetyRule via the admin API.
 *
 * `type` should match a recognised rule type string such as
 * `'prompt_injection'`, `'jailbreak'`, or `'confidential'`.
 */
export class CreateSafetyRuleDto {
  /** Rule category type string (e.g. 'prompt_injection', 'jailbreak'). */
  @IsString()
  @IsNotEmpty()
  type!: string;

  /** Regex or plain-text pattern used for matching. */
  @IsString()
  @IsNotEmpty()
  pattern!: string;

  /** Whether `pattern` is treated as a regular expression. */
  @IsBoolean()
  isRegex!: boolean;

  /** Whether the rule is active; defaults to `true` when omitted. */
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

/**
 * DTO for partially updating an existing SafetyRule.
 * All fields are optional — only provided fields will be updated.
 */
export class UpdateSafetyRuleDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  type?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  pattern?: string;

  @IsBoolean()
  @IsOptional()
  isRegex?: boolean;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

// ── BlacklistEntry DTOs ────────────────────────────────────────────────────

/**
 * DTO for creating a new BlacklistEntry via the admin API.
 *
 * `type` should be one of `'confidential'`, `'internal'`, or a custom
 * category string recognised by SafetyService.
 */
export class CreateBlacklistEntryDto {
  /** The keyword or phrase to blacklist. */
  @IsString()
  @IsNotEmpty()
  keyword!: string;

  /** Entry category (e.g. 'confidential', 'internal', 'pricing_sensitive'). */
  @IsString()
  @IsNotEmpty()
  type!: string;

  /** Whether the entry is active; defaults to `true` when omitted. */
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

/**
 * DTO for partially updating an existing BlacklistEntry.
 * All fields are optional.
 */
export class UpdateBlacklistEntryDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  keyword?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  type?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
