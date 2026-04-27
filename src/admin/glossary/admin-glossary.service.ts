import { Injectable, NotFoundException } from '@nestjs/common';
import type { GlossaryTerm } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { IntentService } from '../../intent/intent.service';
import { CreateGlossaryTermDto, UpdateGlossaryTermDto } from './dto/glossary-admin.dto';

/**
 * AdminGlossaryService — admin CRUD for glossary terms.
 *
 * Writes directly to `glossary_terms` via PrismaService (global), then calls
 * `IntentService.invalidateCache()` so the in-memory synonym-expansion cache
 * reflects changes immediately without a restart.
 *
 * Note: Auth / RBAC is explicitly deferred per spec.md v1.6.0.
 */
@Injectable()
export class AdminGlossaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly intentService: IntentService,
  ) {}

  /** Return all glossary terms ordered by id. */
  async listAll(): Promise<GlossaryTerm[]> {
    return this.prisma.glossaryTerm.findMany({ orderBy: { id: 'asc' } });
  }

  /**
   * Return a single GlossaryTerm by id.
   *
   * @throws NotFoundException when no term exists for the given id.
   */
  async getOne(id: number): Promise<GlossaryTerm> {
    const entry = await this.prisma.glossaryTerm.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException(`GlossaryTerm #${id} not found`);
    return entry;
  }

  /**
   * Create a new GlossaryTerm and reload the intent / glossary cache.
   *
   * The new term is immediately available for synonym expansion after this call.
   */
  async create(dto: CreateGlossaryTermDto): Promise<GlossaryTerm> {
    const entry = await this.prisma.glossaryTerm.create({
      data: {
        term: dto.term,
        synonyms: dto.synonyms,
        intentLabel: dto.intentLabel ?? null,
      },
    });
    await this.intentService.invalidateCache();
    return entry;
  }

  /**
   * Partially update a GlossaryTerm and reload the intent / glossary cache.
   *
   * Only the fields present in the DTO are updated.
   *
   * @throws NotFoundException when no term exists for the given id.
   */
  async update(id: number, dto: UpdateGlossaryTermDto): Promise<GlossaryTerm> {
    await this.getOne(id);
    const entry = await this.prisma.glossaryTerm.update({
      where: { id },
      data: {
        ...(dto.synonyms !== undefined && { synonyms: dto.synonyms }),
        ...(dto.intentLabel !== undefined && { intentLabel: dto.intentLabel }),
      },
    });
    await this.intentService.invalidateCache();
    return entry;
  }

  /**
   * Physically delete a GlossaryTerm and reload the intent / glossary cache.
   *
   * @throws NotFoundException when no term exists for the given id.
   */
  async remove(id: number): Promise<void> {
    await this.getOne(id);
    await this.prisma.glossaryTerm.delete({ where: { id } });
    await this.intentService.invalidateCache();
  }

  /** Manually trigger an IntentService cache reload from the database. */
  async invalidateCacheManual(): Promise<void> {
    await this.intentService.invalidateCache();
  }
}
