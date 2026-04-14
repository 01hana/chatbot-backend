# pg_trgm 可用性策略

## 概述

震南 AI 客服後端在 Phase 2 的 RAG 知識檢索主方案使用 **PostgreSQL `pg_trgm` 擴充套件**
進行字串相似度搜尋（`similarity()` + `gin_trgm_ops` 索引）。

本文件記錄 `pg_trgm` 的確認方式、以及在不支援環境下的 fallback 策略。

---

## 確認方式

在開發 / 部署的 Postgres 執行：

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SELECT similarity('震南', '震南鋼板') AS score;
```

- 若 `CREATE EXTENSION` 成功 → 環境支援 `pg_trgm`，設定 `.env` 中 `PG_TRGM_ENABLED=true`。
- 若回傳 `ERROR: could not open extension control file` → 不支援，設定 `PG_TRGM_ENABLED=false`。

環境說明：

| 環境 | Postgres 版本 | pg_trgm 支援 |
|------|---------------|-------------|
| 本地 Docker (docker-compose) | postgres:16 | ✅ 預設內建 |
| Neon / Supabase | 14+ | ✅ 支援 |
| AWS RDS (vanilla) | 依版本 | ⚠️ 需手動啟用 |
| 自架 Postgres < 9.1 | — | ❌ 不支援 |

---

## 主方案（pg_trgm 可用）

```sql
-- Phase 1 migration 中已建立：
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_knowledge_content_trgm
  ON knowledge_entries USING GIN (content gin_trgm_ops);
```

**RetrievalService** 執行：

```sql
SELECT *, similarity(content, $1) AS score
FROM knowledge_entries
WHERE status = 'approved'
  AND visibility = 'public'
  AND similarity(content, $1) > $2   -- rag_minimum_score from SystemConfig
ORDER BY score DESC
LIMIT 10;
```

---

## Fallback 策略（pg_trgm 不可用）

當 `PG_TRGM_ENABLED=false` 時，`PostgresRetrievalService` 自動切換至 ILIKE 全文比對：

```sql
SELECT *
FROM knowledge_entries
WHERE status = 'approved'
  AND visibility = 'public'
  AND content ILIKE '%' || $1 || '%'
LIMIT 10;
```

**Fallback 影響：**
- 無相似度分數 → 回傳的 `score` 固定為 `0.5`（佔位值）
- 建議降低 `rag_confidence_threshold`（Admin API 可動態調整）
- 不影響安全防護、Pipeline 其他步驟、或 API 合約

---

## 環境變數

| 變數 | 說明 | 預設值 |
|------|------|--------|
| `PG_TRGM_ENABLED` | 控制 RetrievalService 使用哪種查詢策略 | `true` |

---

## Phase 0 現況

Phase 0 **不實作 RetrievalModule**。此文件預先記錄策略，供 Phase 2 實作時參考。

Phase 1 migration 會嘗試 `CREATE EXTENSION IF NOT EXISTS pg_trgm`；
若環境不支援，migration 不報錯，且 GIN 索引建立步驟會以 `IF NOT EXISTS` 包裹。
