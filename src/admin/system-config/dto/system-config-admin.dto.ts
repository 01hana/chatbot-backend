import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

/** DTO for updating a single SystemConfig entry via the admin API. */
export class UpdateSystemConfigDto {
  @IsString()
  @IsNotEmpty()
  value!: string;

  @IsString()
  @IsOptional()
  description?: string;
}
