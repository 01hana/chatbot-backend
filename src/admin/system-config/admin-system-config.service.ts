import { Injectable, NotImplementedException } from '@nestjs/common';
import { UpdateSystemConfigDto } from './dto/system-config-admin.dto';

/**
 * AdminSystemConfigService — Phase 1 skeleton.
 *
 * All methods throw NotImplementedException until a future Phase wires in
 * the real SystemConfigService logic (including cache invalidation).
 */
@Injectable()
export class AdminSystemConfigService {
  listAll(): never {
    throw new NotImplementedException('SystemConfig list not yet implemented');
  }

  getOne(_key: string): never {
    throw new NotImplementedException('SystemConfig get not yet implemented');
  }

  update(_key: string, _data: UpdateSystemConfigDto): never {
    throw new NotImplementedException('SystemConfig update not yet implemented');
  }
}
