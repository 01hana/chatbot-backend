import { Injectable, NotImplementedException } from '@nestjs/common';
import { CreateKnowledgeDto, UpdateKnowledgeDto } from './dto/knowledge-admin.dto';

/**
 * AdminKnowledgeService — Phase 1 skeleton.
 *
 * All methods throw NotImplementedException until Phase 6 (T6-xxx) wires in
 * the real KnowledgeService / KnowledgeRepository logic.
 */
@Injectable()
export class AdminKnowledgeService {
  listAll(): never {
    throw new NotImplementedException('Knowledge list not yet implemented');
  }

  getOne(_id: number): never {
    throw new NotImplementedException('Knowledge get not yet implemented');
  }

  create(_data: CreateKnowledgeDto): never {
    throw new NotImplementedException('Knowledge create not yet implemented');
  }

  update(_id: number, _data: UpdateKnowledgeDto): never {
    throw new NotImplementedException('Knowledge update not yet implemented');
  }

  remove(_id: number): never {
    throw new NotImplementedException('Knowledge delete not yet implemented');
  }
}
