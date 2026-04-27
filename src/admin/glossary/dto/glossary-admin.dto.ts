import { IsString, IsNotEmpty, IsArray, IsOptional } from 'class-validator';

/** DTO for creating a GlossaryTerm via the admin API. */
export class CreateGlossaryTermDto {
  /** Canonical term (must be unique across all glossary entries). */
  @IsString()
  @IsNotEmpty()
  term!: string;

  /** Alternate forms, abbreviations, or synonyms for this term. */
  @IsArray()
  @IsString({ each: true })
  synonyms!: string[];

  /** Optional associated intent label for routing hints. */
  @IsString()
  @IsOptional()
  intentLabel?: string;
}

/** DTO for partially updating a GlossaryTerm via the admin API. */
export class UpdateGlossaryTermDto {
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  synonyms?: string[];

  @IsString()
  @IsOptional()
  intentLabel?: string;
}
