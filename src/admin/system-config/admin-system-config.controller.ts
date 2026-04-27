import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { SystemConfig } from '../../generated/prisma/client';
import { UpdateSystemConfigDto } from './dto/system-config-admin.dto';
import { AdminSystemConfigService } from './admin-system-config.service';

/**
 * AdminSystemConfigController — REST endpoints for /api/v1/admin/system-config.
 *
 * Auth / RBAC is explicitly deferred per spec.md v1.6.0.
 */
@Controller('admin/system-config')
export class AdminSystemConfigController {
  constructor(private readonly adminSystemConfigService: AdminSystemConfigService) {}

  /** List all system configuration entries. */
  @Get()
  listAll(): Promise<SystemConfig[]> {
    return this.adminSystemConfigService.listAll();
  }

  /** Get a single SystemConfig entry by key. */
  @Get(':key')
  getOne(@Param('key') key: string): Promise<SystemConfig> {
    return this.adminSystemConfigService.getOne(key);
  }

  /** Upsert a SystemConfig entry (creates the key if it does not yet exist). */
  @Patch(':key')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('key') key: string,
    @Body() dto: UpdateSystemConfigDto,
  ): Promise<SystemConfig> {
    return this.adminSystemConfigService.update(key, dto);
  }
}
