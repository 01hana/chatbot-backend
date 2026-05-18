/**
 * AnswerMode — describes the path that produced the final answer for a turn.
 *
 * - 'llm'         : answer generated directly by the LLM (legacy path or no RAG context)
 * - 'rag+template': template selected via RAG, filled with retrieved entries
 * - 'template'    : static template selected without LLM generation
 * - 'hybrid_rag'  : LLM generation augmented by hybrid retrieval (Phase 3+ path)
 * - 'fallback'    : no sufficient knowledge found; canned fallback response sent
 *
 * Note: 'rag' is intentionally excluded. When templateResolver.strategy='rag':
 *   - hybrid retrieval path → 'hybrid_rag'
 *   - legacy retrieval + LLM path → 'llm'
 */
export type AnswerMode = 'llm' | 'rag+template' | 'template' | 'hybrid_rag' | 'fallback';
