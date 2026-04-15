import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { UpdateSystemConfigDto } from './dto/system-config-admin.dto';
import { AdminSystemConfigService } from './admin-system-config.service';

/**
 * AdminSystemConfigController — skeleton routes for /api/v1/admin/system-config.
 *
 * Phase 1 status: All endpoints return 501 Not Implemented.
 * A future Phase will wire in real SystemConfigService logic so that
 * `invalidateCache()` is called after every write.
 *
 * Note: Auth / RBAC is explicitly deferred per spec.md v1.6.0.
 */
@Controller('admin/system-config')
export class AdminSystemConfigController {
  constructor(private readonly adminSystemConfigService: AdminSystemConfigService) {}

  /** List all system configuration entries. */
  @Get()
  listAll(): never {
    return this.adminSystemConfigService.listAll();
  }

  /** Get a single SystemConfig entry by key. */
  @Get(':key')
  getOne(@Param('key') key: string): never {
    return this.adminSystemConfigService.getOne(key);
  }

  /** Update the value of an existing SystemConfig entry. */
  @Patch(':key')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('key') key: string,
    @Body() dto: UpdateSystemConfigDto,
  ): never {
    return this.adminSystemConfigService.update(key, dto);
  }
}
