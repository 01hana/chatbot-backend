import { Injectable } from '@nestjs/common';
import { Lead, LeadStatus, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * LeadRepository — data-access layer for the `leads` table.
 */
@Injectable()
export class LeadRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new Lead row.
   */
  async create(data: Prisma.LeadCreateInput): Promise<Lead> {
    return this.prisma.lead.create({ data });
  }

  /**
   * Find a Lead by its primary key.
   */
  async findById(id: number): Promise<Lead | null> {
    return this.prisma.lead.findUnique({ where: { id } });
  }

  /**
   * Find the most recent active Lead for a given conversationId.
   * Returns null when no lead exists for the conversation.
   */
  async findByConversationId(conversationId: number): Promise<Lead | null> {
    return this.prisma.lead.findFirst({
      where: { conversationId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * List Leads with optional status filter and pagination.
   */
  async list(params: {
    status?: LeadStatus;
    skip?: number;
    take?: number;
  }): Promise<Lead[]> {
    return this.prisma.lead.findMany({
      where: {
        deletedAt: null,
        ...(params.status ? { status: params.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      skip: params.skip ?? 0,
      take: params.take ?? 50,
    });
  }

  /**
   * Partially update a Lead.
   */
  async update(id: number, data: Prisma.LeadUpdateInput): Promise<Lead> {
    return this.prisma.lead.update({ where: { id }, data });
  }

  /**
   * Update only the admin workflow status field.
   */
  async updateStatus(id: number, status: LeadStatus): Promise<Lead> {
    return this.prisma.lead.update({ where: { id }, data: { status } });
  }

  /**
   * Append a freetext note to the existing notes field (newline-delimited).
   */
  async appendNote(id: number, note: string): Promise<Lead> {
    const existing = await this.prisma.lead.findUnique({
      where: { id },
      select: { notes: true },
    });
    const merged = existing?.notes ? `${existing.notes}\n${note}` : note;
    return this.prisma.lead.update({ where: { id }, data: { notes: merged } });
  }
}
