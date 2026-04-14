/**
 * knowledge.seed.ts — Phase 1 shell (development/test only)
 *
 * IMPORTANT: This seed is ONLY executed when NODE_ENV is NOT 'production'.
 * Enforcement is in seed.ts (the main entry point).
 *
 * Will be implemented in Phase 1 (T1-005) with demo KnowledgeEntry rows.
 */
import { PrismaClient } from '../../src/generated/prisma/client';

export async function seedKnowledge(prisma: PrismaClient): Promise<void> {
  // Implemented in Phase 1 (T1-005)
  void prisma;
}
