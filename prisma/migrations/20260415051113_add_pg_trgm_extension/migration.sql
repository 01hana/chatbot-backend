-- T1-002: pg_trgm extension + trigram index on knowledge_entries.content
--
-- IF NOT EXISTS ensures this is safe to run in environments that already have
-- the extension (e.g. managed cloud Postgres with pre-installed extensions).
-- If the host Postgres build does not include pg_trgm the CREATE EXTENSION
-- statement will fail.  In that case:
--   1. Set PG_TRGM_ENABLED=false in your .env
--   2. The application falls back to ILIKE queries automatically (see retrieval service)
--
-- This migration is intentionally separate from the schema migration so it can
-- be skipped or re-run independently.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram index — dramatically speeds up similarity() / % operator queries
-- on the content column used during RAG retrieval.
CREATE INDEX IF NOT EXISTS idx_knowledge_entries_content_trgm
  ON knowledge_entries
  USING GIN (content gin_trgm_ops);
