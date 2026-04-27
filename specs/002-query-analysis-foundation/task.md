# 震南 AI 客服後端 — 002 工程任務清單

**版本**：1.1.0 | **建立日期**：2026-04-21 | **狀態**：Draft  
**承接文件**：`specs/002-query-analysis-foundation/spec.md` v1.0.0、`plan.md` v1.0.0  
**前置任務清單**：`specs/001-ai-chatbot-backend-system/task.md`（已執行中，Phase 0~3 完成）

---

## 0. 說明

### 0.1 文件性質：Delta Plan

本文件**只列 002 新增或必須重構的任務**，不重抄 001 已完成的 T0 ~ T3 任務。

- **001** 是主線 Phase-based 任務清單（Phase 0 ~ 7），目前 Phase 0~3 已完成，94 tests 通過。
- **002** 是增量修訂任務清單，補齊 001 Phase 4（高意圖問診）啟動前所需的基礎能力。
- **002 不重置 001 已完成進度**。所有 001 程式碼、資料模型、測試在整個 002 執行期間必須保持通過狀態。

### 0.2 如何閱讀本文件

本文件使用**兩層結構**：

| 層級 | 說明 | 用途 |
|------|------|------|
| **Delta Phase A/B/C/D**（高階）| 執行波段分組，對應 `plan.md` 的 Milestone | 瀏覽進度、排定工作排程時使用 |
| **Workstream 任務（KS/QA/IG/TM/DG/RG）**（低階）| 實際可執行的最小任務單位 | 日常追蹤、勾選、PR 對應 |

> **追蹤原則**：PR 標題、勾選進度、依賴管理，一律以低階任務 ID（`KS-001`、`QA-001`…）為準。  
> Delta Phase 標題只是執行視角的分組標籤，不是獨立的 Phase 系統，不與 001 的 Phase 0~7 混淆。

### 0.3 任務命名空間

任務前綴使用以下命名空間（與 001 的 T0~T5 區分）：

| 前綴  | Workstream                           |
| ----- | ------------------------------------ |
| `KS-` | Knowledge Schema Formalisation       |
| `QA-` | QueryAnalysisModule                  |
| `IG-` | Intent / Glossary / Admin Governance |
| `TM-` | Template Strategy                    |
| `DG-` | Diagnosis Foundation                 |
| `RG-` | Regression / Benchmark               |

### 0.4 任務標記說明

| 標記    | 說明                        |
| ------- | --------------------------- |
| `CORE`  | 核心主流程變更              |
| `DATA`  | 資料模型 / migration / seed |
| `ADMIN` | 後台 API                    |
| `TEST`  | 測試 / fixtures             |
| `OPS`   | 設定 / 環境 / rollout       |
| `INTG`  | 外部整合 / 跨模組整合       |

---

## 1. 執行順序

### 1.1 高階：Delta Phase 波段視角

```
Delta Phase A：Knowledge Schema Foundation
  └── KS-001 → KS-002 → KS-003 → KS-004
        │
        ▼（A 完成後展開 B）
Delta Phase B：Query Analysis + Governance
  ├── QA-001 → QA-002 → QA-003 → QA-004 → QA-005
  └── IG-001 → IG-002 → IG-003 → IG-004 → IG-005 → IG-006 → IG-007
        │  （QA 與 IG 可平行進行）
        ▼（B 主要任務完成後展開 C；RG fixtures 可在 B 部分完成後提早建立）
Delta Phase C：Template + Diagnosis Foundation
  ├── TM-001 → TM-002 → TM-003
  └── DG-001 → DG-002 → DG-003
        │
        ▼（B + C 全完成後進行正式驗收）
Delta Phase D：Regression / Rollout Readiness
  └── RG-001 → RG-002 → RG-003
```

### 1.2 低階：Workstream 任務依賴圖

```
KS-001 → KS-002 → KS-003 → KS-004
  ↓ 完成後可開始 QA / IG workstream
QA-001 → QA-002 → QA-003 → QA-004 → QA-005
IG-001 → IG-002 → IG-003 → IG-004 → IG-005 → IG-006 → IG-007
  ↓ QA + IG 均完成後
TM-001 → TM-002 → TM-003
DG-001 → DG-002 → DG-003
RG-001 → RG-002 → RG-003
```

### 1.3 平行執行原則

- **Delta Phase A 完成後**，B 可全面展開。
- **B 中 QA 與 IG 可部分平行**：QA-001（介面定義）可與 IG-001（AdminSystemConfig）同步開始；IG-002/003 依賴 KS-002，可在 KS-002 完成後立即開始，不需等 QA 完成。
- **C 依賴 B 的主要成果**：TM-001 依賴 KS-001 與 QA-001；DG-001 無外部依賴，可在 B 期間平行進行骨架建立。
- **D 可在部分 B / C 完成後提早建立 fixtures**（RG-001 依賴 KS-003 即可），但 RG-003 的正式 CI 驗收放在 B + C 全完成後。

---

## 2. Delta Phase A：Knowledge Schema Foundation

> **波段目標**：在不破壞 001 任何現有行為的前提下，為 KnowledgeEntry 與 IntentTemplate 新增產品級結構化欄位，並升級 seed / admin API，讓後續 QA、IG、TM workstream 有穩固的資料基礎。

### Workstream A：Knowledge Schema Formalisation

---

### KS-001 `DATA`

**標題**：KnowledgeEntry schema migration — 新增產品級欄位

**目標**：為 `knowledge_entries` 表新增 002 所需的結構化欄位，採非破壞式 migration。

**產出物**：

- 新 Prisma migration（`prisma/migrations/`）
- 更新後的 `prisma/schema.prisma`（`KnowledgeEntry` 模型新增欄位）

**新增欄位**：

```
sourceKey             String?          -- stable slug identity
category              String?          -- product-spec | faq-general | pricing | contact | diagnosis
answerType            String  @default("rag")  -- template | rag+template | rag | llm
templateKey           String?          -- points to template key
faqQuestions          String[] @default([])
crossLanguageGroupKey String?
structuredAttributes  Json?
```

**Unique constraint**：`@@unique([sourceKey, language])`（`sourceKey` nullable，NULL 不觸發 unique）

**驗收標準**：

- [x] `npx prisma migrate dev` 無錯誤
- [x] 既有資料：所有現有條目 `answerType='rag'`，其他欄位 null / default
- [x] `KnowledgeEntry` Prisma 型別包含所有新欄位
- [x] `npx jest` 全部 001 tests 仍通過（不因 schema 變動而 break）

**依賴**：無  
**相容性**：向後相容；既有 001 程式碼不需修改

---

### KS-002 `DATA`

**標題**：IntentTemplate schema migration — 新增 isActive / category 欄位

**目標**：讓 IntentTemplate 支援停用（`isActive`）與分類（`category`），為 admin 治理與三層 intent routing 準備。

**產出物**：

- 新 Prisma migration
- 更新後 `prisma/schema.prisma`（`IntentTemplate` 新增欄位）

**新增欄位**：

```
isActive  Boolean @default(true)
category  String?
```

**驗收標準**：

- [x] Migration 無錯誤
- [x] 既有 IntentTemplate 資料：`isActive=true`
- [x] 001 tests 仍全通過

**依賴**：KS-001（同 migration 批次）  
**相容性**：向後相容

---

### KS-003 `DATA`

**標題**：Seed 腳本更新 — 使用 sourceKey upsert 並填充新欄位

**目標**：將所有 knowledge seed 腳本從自增 ID insert 改為 sourceKey-based upsert，並為既有條目補充 category / answerType。

**涉及檔案**：

- `prisma/seeds/knowledge.seed.ts`
- `prisma/seeds/knowledge-public-zh.seed.ts`
- `prisma/seeds/knowledge-public-en.seed.ts`

**Upsert pattern**：

```typescript
await prisma.knowledgeEntry.upsert({
  where: { sourceKey_language: { sourceKey: 'screw-m3-spec', language: 'zh-TW' } },
  update: { title, content, ... },
  create: { sourceKey: 'screw-m3-spec', language: 'zh-TW', answerType: 'rag', ... },
});
```

**驗收標準**：

- [X] `npx prisma db seed` 可執行兩次（idempotent），無錯誤、無重複條目
- [X] 所有既有 knowledge entries 均有 `sourceKey`（不得為 null）
- [X] `category` 已依業務分類填入（product-spec / faq-general / pricing / contact）
- [X] `answerType` 全部為 `'rag'`（002 初期所有條目仍走 RAG 路徑）

**依賴**：KS-001  
**相容性**：Seed 腳本變更不影響 test；e2e seed test 需通過

---

### KS-004 `ADMIN`

**標題**：Admin Knowledge DTO / Service 擴充 — 支援新欄位 CRUD

**目標**：讓 admin knowledge API 支援 KS-001 新增的欄位，管理者可透過 API 設定 `category` / `answerType` / `sourceKey` / `faqQuestions` / `crossLanguageGroupKey`。

**涉及檔案**：

- `src/admin/knowledge/dto/knowledge-admin.dto.ts`
- `src/admin/knowledge/admin-knowledge.service.ts`
- `src/admin/knowledge/admin-knowledge.service.spec.ts`

**DTO 新增欄位（所有可選）**：

```typescript
@IsOptional() @IsString() sourceKey?: string;
@IsOptional() @IsString() category?: string;
@IsOptional() @IsIn(['template', 'rag+template', 'rag', 'llm']) answerType?: string;
@IsOptional() @IsString() templateKey?: string;
@IsOptional() @IsArray() @IsString({ each: true }) faqQuestions?: string[];
@IsOptional() @IsString() crossLanguageGroupKey?: string;
```

**驗收標準**：

- [X] `CreateKnowledgeDto` / `UpdateKnowledgeDto` 包含所有新欄位的 class-validator 裝飾器
- [X] `AdminKnowledgeService.create()` / `update()` 正確持久化新欄位
- [X] `AdminKnowledgeService` 新增 `findByCategory()` 方法
- [X] 新增 unit tests：建立 / 更新含 sourceKey+category+answerType 的條目

**依賴**：KS-001、KS-003  
**相容性**：新欄位全為可選；現有 API 請求不受影響

---

## 3. Delta Phase B：Query Analysis + Governance

> **波段目標**：002 的主體工作。建立 QueryAnalysisModule（查詢理解），將 query rules、ranking profile 納入 DB 治理，並透過 admin/intent、admin/glossary API 落地 Intent / Glossary 的完整治理能力，以及 IntentService 三層路由。QA 與 IG 兩條線可在 Delta Phase A 完成後**平行推進**。

### Workstream B：QueryAnalysisModule

---

### QA-001 `CORE`

**標題**：QueryAnalysisModule skeleton — 介面定義與模組骨架

**目標**：建立 `src/query-analysis/` 模組骨架，定義所有核心介面，讓後續任務可獨立實作。

**產出物**：

- `src/query-analysis/query-analysis.module.ts`
- `src/query-analysis/query-analysis.service.ts`（骨架，呼叫 IQueryAnalyzer）
- `src/query-analysis/interfaces/query-analyzer.interface.ts`
- `src/query-analysis/interfaces/tokenizer.interface.ts`
- `src/query-analysis/interfaces/query-rule-provider.interface.ts`
- `src/query-analysis/interfaces/query-expansion-provider.interface.ts`
- `src/query-analysis/types/analyzed-query.type.ts`

**驗收標準**：

- [x] TypeScript 編譯無錯誤
- [x] `QueryAnalysisModule` 可被 `AppModule` / `ChatModule` import 而不報錯
- [x] `IQueryAnalyzer.analyze()` 方法簽章定義完整（`raw: string, language?: string`）
- [x] `AnalyzedQuery` type 含 spec.md FR-QA-001 定義的所有欄位

**依賴**：無（可與 KS 同步開始）  
**相容性**：不修改任何現有檔案

---

### QA-002 `CORE`

**標題**：RuleBasedQueryAnalyzer — 預設實作（10-step pipeline）

**目標**：實作 `IQueryAnalyzer` 的預設 rule-based 實作，移植 `QueryNormalizer` 現有邏輯並擴充為 AnalyzedQuery 輸出。

**涉及檔案**：

- `src/query-analysis/analyzers/rule-based-query-analyzer.ts`（新增）
- `src/query-analysis/tokenizers/rule-based-tokenizer.ts`（新增）

**設計要點**：

- Step 1~5：移植 `QueryNormalizer.normalize()` 邏輯（不刪除 QueryNormalizer，保留向後相容）
- Step 5~7：新增 tokenization / term extraction / phrase detection
- Step 8：呼叫 `IQueryExpansionProvider.expand()` 產出 expandedTerms
- Step 9：profile selection 邏輯（基於 intentHints + query 特徵）
- Step 10：組裝完整 AnalyzedQuery（含 debugMeta.processingMs）

**驗收標準**：

- [x] `analyze('請問你們有哪些螺絲類別', 'zh-TW')` 產出：
  - `normalizedQuery` 包含 `'螺絲類別'`
  - `terms` 包含螺絲相關詞彙
  - `selectedProfile = 'faq'`（有問法結構）
- [x] `analyze('M3 stainless steel bolts', 'en')` 產出：
  - `normalizedQuery = 'M3 stainless steel bolts'`
  - `terms = ['M3', 'stainless', 'steel', 'bolts']`
  - `selectedProfile = 'product'`（全為 product terms）
- [x] Unit tests 覆蓋：zh-TW normalize / en normalize / term extraction / phrase detection / profile selection

**依賴**：QA-001  
**相容性**：`QueryNormalizer` 保留不刪，不破壞現有程式碼

---

### QA-003 `CORE`

**標題**：DbQueryRuleProvider — DB 管理 query rules（stop words / question-shell patterns）

**目標**：建立從 DB 讀取 query rules 的 Provider，帶 in-memory cache 與 invalidation。

**產出物**：

- `src/query-analysis/providers/db-query-rule-provider.ts`
- Prisma migration：新增 `query_rules` 表
- Seed：基礎 stop words 與 question-shell patterns

**Prisma model**：

```prisma
model QueryRule {
  id        Int     @id @default(autoincrement())
  type      String  // stop_word | noise_word | question_shell_zh | question_shell_en
  language  String  @default("zh-TW")
  value     String  // 規則值（word / regex pattern）
  isActive  Boolean @default(true)
  priority  Int     @default(0)
  createdAt DateTime @default(now())

  @@map("query_rules")
}
```

**Seed 基礎資料**：

- zh-TW stop words：請問、你好、謝謝、麻煩你、告訴我...（至少 15 筆）
- en stop words：（從 QueryNormalizer.EN_STOP_WORDS 移入）
- question-shell patterns：（從 QueryNormalizer hardcoded patterns 移入）

**Fallback 設計**：若 DB 無資料或查詢失敗，fallback 至 QueryNormalizer 的 hardcoded patterns（向後相容）。

**驗收標準**：

- [x] `DbQueryRuleProvider.getStopWords('zh-TW')` 回傳 DB 中的 stop words
- [x] `invalidateCache()` 後重新從 DB 讀取
- [x] DB 無資料時 fallback 至 hardcoded（unit test with empty mock）
- [x] Seed 資料正常載入

**依賴**：QA-001、QA-002  
**相容性**：Fallback 設計確保即使無 DB 資料也能正常運作

---

### QA-004 `CORE`

**標題**：GlossaryExpansionProvider + SystemConfigRankProfileProvider

**目標**：

1. 建立 `GlossaryExpansionProvider`，從 `IntentService` cache 讀取 GlossaryTerm 做詞彙展開
2. 建立 `SystemConfigRankProfileProvider`，從 SystemConfig 讀取 ranking profile

**產出物**：

- `src/query-analysis/providers/glossary-expansion-provider.ts`
- `src/retrieval/providers/system-config-rank-profile-provider.ts`
- `RankingProfile` type 定義

**設計要點**：

- `GlossaryExpansionProvider` 不直接查 DB，從 `IntentService.getCachedGlossary()` 讀取（避免重複快取）
- `SystemConfigRankProfileProvider.getProfile(key)` 若無對應 key，fallback 到 `RETRIEVAL_SCORING` 靜態常數
- `PostgresRetrievalService` 改用 `SystemConfigRankProfileProvider` 取得 weights（不硬用 RETRIEVAL_SCORING）

**驗收標準**：

- [x] `GlossaryExpansionProvider.expand(['螺絲'], 'zh-TW')` 在 GlossaryTerm cache 有 `{term: '螺絲', synonyms: ['螺釘', 'screw']}` 時回傳 `['螺絲', '螺釘', 'screw']`
- [x] `SystemConfigRankProfileProvider.getProfile('faq')` 回傳對應 profile（SystemConfig 有 `ranking.faq.*` keys）
- [x] Fallback：無 SystemConfig key 時回傳 RETRIEVAL_SCORING 等價值
- [x] Unit tests 覆蓋兩個 Provider

**依賴**：QA-001、QA-002、QA-003  
**相容性**：PostgresRetrievalService 的 scoring 值不變（fallback 確保）

---

### QA-005 `INTG`

**標題**：Chat Pipeline 整合 QueryAnalysisService（feature flag 控制）

**目標**：將 `QueryAnalysisService` 整合進 Chat Pipeline，以 feature flag `feature.query_analysis_enabled` 控制切換。

**涉及檔案**：

- `src/chat/chat-pipeline.service.ts`
- `src/chat/chat.module.ts`

**整合要點**：

- 在 Pipeline Step 2（語言偵測）後，新增 Step 2.5：`QueryAnalysisService.analyze()`
- feature flag = false → 沿用 `QueryNormalizer.normalize()`（001 行為）
- feature flag = true → 使用 AnalyzedQuery
- `AnalyzedQuery` 存入 `PipelineContext`（新增 `analyzedQuery?: AnalyzedQuery`）
- RetrievalQuery 傳入 `analyzedQuery.terms` / `analyzedQuery.selectedProfile`
- IntentService.detect() 傳入 `analyzedQuery`（可選參數，向後相容）

**驗收標準**：

- [X] `feature.query_analysis_enabled=false`：全部 001 pipeline tests 通過，行為不變
- [X] `feature.query_analysis_enabled=true`：AnalyzedQuery 被產出且存入 context
- [X] AuditLog 包含 `selectedProfile` / `extractedTerms` / `matchedQueryRules`（feature flag = true 時）
- [X] unit test：mock QueryAnalysisService，驗證 feature flag 切換行為

**依賴**：QA-001、QA-002、QA-003、QA-004  
**相容性**：feature flag = false 確保 001 行為完整保留

---

### Workstream C：Intent / Glossary / Admin Governance

---

### IG-001 `ADMIN`

**標題**：AdminSystemConfigService 落地 — CRUD + cache invalidation

**目標**：讓 `AdminSystemConfigService` 正式實作，移除所有 `NotImplementedException`。

**涉及檔案**：

- `src/admin/system-config/admin-system-config.service.ts`
- `src/admin/system-config/admin-system-config.controller.ts`
- `src/admin/system-config/dto/system-config-admin.dto.ts`
- `src/system-config/system-config.service.ts`（新增 `invalidateCache()`）

**API endpoints（正式落地）**：

```
GET    /api/v1/admin/system-config         → 列出所有 keys
GET    /api/v1/admin/system-config/:key    → 取得單一 key
PATCH  /api/v1/admin/system-config/:key    → upsert（含 cache invalidation）
```

**驗收標準**：

- [x] `GET /api/v1/admin/system-config` 回傳所有 SystemConfig entries（JSON array）
- [x] `PATCH /api/v1/admin/system-config/rag_minimum_score` 更新值後，下一次 `SystemConfigService.getNumber('rag_minimum_score')` 立即反映（不需重啟）
- [x] Unit tests：findAll / upsert / cache invalidation
- [x] `NotImplementedException` 全數移除

**依賴**：KS-001  
**相容性**：SystemConfig 現有讀取行為不變；只新增 invalidate 路徑

---

### IG-002 `DATA` `ADMIN`

**標題**：admin/intent/\* API — IntentTemplate CRUD + cache invalidation

**目標**：新增 `admin/intent` 模組，提供 IntentTemplate 的完整 CRUD，並在 mutate 後自動觸發 IntentService cache invalidation。

**新增模組**：

- `src/admin/intent/admin-intent.module.ts`
- `src/admin/intent/admin-intent.controller.ts`
- `src/admin/intent/admin-intent.service.ts`
- `src/admin/intent/dto/create-intent-template.dto.ts`
- `src/admin/intent/dto/update-intent-template.dto.ts`

**API endpoints**：

```
GET    /api/v1/admin/intent           → 列出所有 IntentTemplate
POST   /api/v1/admin/intent           → 建立新 IntentTemplate
GET    /api/v1/admin/intent/:id       → 取得單一 IntentTemplate
PATCH  /api/v1/admin/intent/:id       → 更新 IntentTemplate
DELETE /api/v1/admin/intent/:id       → 停用（isActive=false，不實體刪除）
POST   /api/v1/admin/intent/cache/invalidate → 手動觸發 cache reload
```

**DTO（CreateIntentTemplateDto）**：

```typescript
@IsString() @IsNotEmpty() intent: string;
@IsString() @IsNotEmpty() label: string;
@IsArray() @IsString({ each: true }) keywords: string[];
@IsString() @IsNotEmpty() templateZh: string;
@IsString() @IsNotEmpty() templateEn: string;
@IsNumber() @IsOptional() priority?: number;
@IsString() @IsOptional() category?: string;
```

**驗收標準**：

- [x] POST 建立後，`IntentService.getCachedTemplates()` 包含新 template（下一次 detect 可用）
- [x] DELETE（停用）後，`IntentService.detect()` 不再使用此 template
- [x] Unit tests：CRUD + cache invalidation
- [x] Admin module wired 進 `AdminModule`

**依賴**：KS-002、IG-001  
**相容性**：IntentService 新增 isActive filter（detect 時跳過 `isActive=false` 的 templates）

---

### IG-003 `DATA` `ADMIN`

**標題**：admin/glossary/\* API — GlossaryTerm CRUD + cache invalidation

**目標**：新增 `admin/glossary` 模組，提供 GlossaryTerm 的完整 CRUD，並在 mutate 後自動觸發 IntentService cache invalidation。

**新增模組**：

- `src/admin/glossary/admin-glossary.module.ts`
- `src/admin/glossary/admin-glossary.controller.ts`
- `src/admin/glossary/admin-glossary.service.ts`
- `src/admin/glossary/dto/create-glossary-term.dto.ts`
- `src/admin/glossary/dto/update-glossary-term.dto.ts`

**API endpoints**：

```
GET    /api/v1/admin/glossary         → 列出所有 GlossaryTerm
POST   /api/v1/admin/glossary         → 建立新 GlossaryTerm
GET    /api/v1/admin/glossary/:id     → 取得單一 GlossaryTerm
PATCH  /api/v1/admin/glossary/:id     → 更新 GlossaryTerm（synonyms / intentLabel）
DELETE /api/v1/admin/glossary/:id     → 實體刪除
POST   /api/v1/admin/glossary/cache/invalidate → 手動觸發 cache reload
```

**驗收標準**：

- [x] POST 建立後，`IntentService.getCachedGlossary()` 立即包含新 term
- [x] DELETE 後，`getCachedGlossary()` 不再有此 term
- [x] Unit tests：CRUD + cache invalidation
- [x] Admin module wired 進 `AdminModule`

**依賴**：IG-001  
**相容性**：IntentService.expandWithGlossary() 行為不變（cache 資料源不變）

---

### IG-004 `OPS`

**標題**：Ranking Profile SystemConfig keys 種子資料

**目標**：在 seed 腳本中新增 ranking profile 相關的 SystemConfig keys，讓 profile provider 有初始值可讀取。

**涉及檔案**：

- `prisma/seeds/widget-config.seed.ts`（或新增 `ranking-config.seed.ts`）

**Seed 新增 keys**：

```
ranking.default.title_boost = 1.2
ranking.default.alias_ilike_bonus = 0.10
ranking.default.tag_ilike_bonus = 0.05
ranking.default.trgm_threshold = 0.10
ranking.default.content_weight = 1.0
ranking.faq.title_boost = 1.0
ranking.faq.alias_ilike_bonus = 0.20
ranking.faq.tag_ilike_bonus = 0.03
ranking.faq.trgm_threshold = 0.08
ranking.diagnosis.title_boost = 1.0
ranking.diagnosis.tag_ilike_bonus = 0.15
ranking.diagnosis.alias_ilike_bonus = 0.05
feature.query_analysis_enabled = false
feature.profile_selection_mode = rule-based
```

**驗收標準**：

- [x] `prisma db seed` 成功植入這些 keys
- [x] `SystemConfigService.getNumber('ranking.default.title_boost')` 回傳 1.2
- [x] `SystemConfigService.getBoolean('feature.query_analysis_enabled')` 回傳 false

**依賴**：IG-001  
**相容性**：僅新增 seed keys，不修改現有 SystemConfig 邏輯

---

### IG-005 `CORE`

**標題**：IntentService 三層路由重構

**目標**：將 `IntentService.detect()` 升級為三層分流架構，使用 `analyzedQuery` 中的 `intentHints` 和 `expandedTerms`，同時保持向後相容（`analyzedQuery` 為可選參數）。

**涉及檔案**：

- `src/intent/intent.service.ts`
- `src/intent/intent.service.spec.ts`

**detect() 新簽章**：

```typescript
detect(
  input: string,
  language: string,
  analyzedQuery?: AnalyzedQuery,   // 002 新增，可選
): IntentDetectResult
```

**三層邏輯**：

```
Layer 1：若 analyzedQuery?.intentHints 有高信心 hint（score > 0.7）
          → 直接回傳
Layer 2：使用 analyzedQuery?.expandedTerms 或 expandWithGlossary(input)
          做 keyword matching（現有邏輯，但 input 更豐富）
Layer 3：若 ragResults 帶有 category（此 layer 在 pipeline 層處理，detect() 不直接接觸 ragResults）
```

**isActive filter**：在 templates 迭代時跳過 `isActive=false` 的 template。

**驗收標準**：

- [x] `detect(input, language)`（不傳 analyzedQuery）行為與 001 完全一致（unit test with existing 001 test cases）
- [x] `detect(input, language, analyzedQuery)` 使用 expandedTerms 進行匹配（unit test）
- [x] Layer 1 高信心 hint 直接採用（unit test）
- [x] `isActive=false` 的 template 被跳過（unit test）
- [x] 新增 intent fixture 測試：至少 5 種 intent（product-inquiry / pricing-inquiry / contact-inquiry / general-faq / product-diagnosis）準確率 ≥ 85%

**依賴**：QA-001、IG-002  
**相容性**：detect(input, language) 兩參數版本向後相容

---

### IG-006 `CORE`

**標題**：GlossaryExpansionProvider 整合至 IntentService（重構 expandWithGlossary）

**目標**：將 `IntentService.expandWithGlossary()` 重構，使其透過 `IQueryExpansionProvider` 介面，讓 QueryAnalysisModule 和 IntentService 共享同一展開邏輯（避免重複）。

**設計說明**：

- `IntentService` 注入 `IQueryExpansionProvider`（實作為 `GlossaryExpansionProvider`）
- `expandWithGlossary()` 改為呼叫 `IQueryExpansionProvider.expand()`
- `GlossaryExpansionProvider` 從 `IntentService.getCachedGlossary()` 讀取（避免兩個 cache）

**驗收標準**：

- [x] `IntentService.expandWithGlossary()` 重構後行為與重構前完全一致（unit test）
- [x] `GlossaryExpansionProvider` 可被 `QueryAnalysisModule` 和 `IntentModule` 共用

**依賴**：QA-004、IG-005  
**相容性**：行為不變，只重構依賴注入路徑

---

### IG-007 `TEST`

**標題**：Intent / Glossary admin API unit tests

**目標**：完整覆蓋 admin/intent 和 admin/glossary 的 unit tests。

**涉及檔案**：

- `src/admin/intent/admin-intent.service.spec.ts`（新增）
- `src/admin/glossary/admin-glossary.service.spec.ts`（新增）

**測試案例（各 module 至少 8 個）**：

- CRUD 基本操作（create / findAll / findById / update / delete）
- 建立後 cache invalidation 被呼叫
- 停用 intent template（isActive=false）
- 停用後 detect() 不使用此 template
- 刪除 glossary term 後 cache invalidation

**驗收標準**：

- [x] admin-intent service spec：≥ 8 個測試通過
- [x] admin-glossary service spec：≥ 8 個測試通過

**依賴**：IG-002、IG-003  
**相容性**：純測試，不修改實作

---

## 4. Delta Phase C：Template + Diagnosis Foundation

> **波段目標**：在 Delta Phase B 提供的 QueryAnalysis + Intent 能力基礎上，建立 AnswerTemplateResolver（四路徑回答策略）與 DiagnosisService（問診狀態機）。這兩條線可平行進行，完成後即具備進入 001 Phase 4 的前置條件。

### Workstream D：Template Strategy

---

### TM-001 `CORE`

**標題**：AnswerTemplateResolver — template resolution 四路徑邏輯

**目標**：建立 `AnswerTemplateResolver`，根據 KnowledgeEntry.answerType 決定回答路徑（template / rag+template / rag / llm）。

**新增模組**：

- `src/template/template.module.ts`
- `src/template/answer-template-resolver.ts`
- `src/template/types/template-resolution.type.ts`
- `src/template/answer-template-resolver.spec.ts`

**resolve() 邏輯**：

```typescript
resolve(
  ragResults: RetrievalResult[],
  intentLabel: string | null,
  language: string,
): TemplateResolution
```

四路徑決定規則（見 design.md §8.3）。

**驗收標準**：

- [ ] `answerType='template'`：回傳 `{ strategy: 'template', resolvedContent: entry.content }`
- [ ] `answerType='rag+template'`：回傳 `{ strategy: 'rag+template', resolvedContent: template填空後內容 }`
- [ ] `answerType='rag'`：回傳 `{ strategy: 'rag' }`（走現有 LLM 路徑）
- [ ] `answerType='llm'`：回傳 `{ strategy: 'llm' }`
- [ ] ragResults 為空：回傳 `{ strategy: 'llm' }`（現有 fallback 路徑）
- [ ] template 路徑 deterministic（相同輸入多次呼叫結果相同）
- [ ] Unit tests：≥ 6 個測試案例（涵蓋四路徑 + 空 ragResults）

**依賴**：KS-001、KS-004、QA-001  
**相容性**：預設 `answerType='rag'`，001 所有現有條目走 rag 路徑，行為不變

---

### TM-002 `INTG`

**標題**：Chat Pipeline 整合 TemplateResolver

**目標**：在 Chat Pipeline 中整合 `AnswerTemplateResolver`，讓 template / rag+template 路徑可以跳過 LLM 呼叫。

**涉及檔案**：

- `src/chat/chat-pipeline.service.ts`
- `src/chat/chat.module.ts`
- `src/chat/chat-pipeline.service.spec.ts`

**Pipeline 新增步驟（Step 9 後）**：

```typescript
const templateResolution = this.templateResolver.resolve(
  ctx.ragResults,
  ctx.intentLabel,
  ctx.language,
);

if (['template', 'rag+template'].includes(templateResolution.strategy)) {
  // 寫入 SSE token、done event，跳過 LLM
  res.write(formatSseEvent('token', { token: templateResolution.resolvedContent! }));
  this.writeSseAndEnd(res, 'done', {
    messageId: assistantMsg.id,
    action: 'answer',
    intentLabel: ctx.intentLabel,
    sourceReferences: ctx.ragResults.map(r => r.entry.id),
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  });
  return;
}

// 繼續走現有 LLM 路徑（rag / llm）
```

**驗收標準**：

- [ ] `answerType='template'` 條目命中時，LLM 不被呼叫（mock LLM provider 未被呼叫）
- [ ] `answerType='rag'` 條目命中時，行為與 001 完全一致（001 pipeline tests 通過）
- [ ] template 路徑的 SSE done event `action='answer'`（與現有 answer 路徑一致）
- [ ] 新增 Pipeline unit tests：template 路徑 + rag+template 路徑

**依賴**：TM-001  
**相容性**：001 所有條目 `answerType='rag'`，所有現有 pipeline tests 不受影響

---

### TM-003 `TEST`

**標題**：Template strategy integration tests + backward compat 驗證

**目標**：驗證 template 策略整合後所有 001 pipeline tests 仍通過，並新增 template 路徑 integration tests。

**涉及檔案**：

- `src/chat/chat-pipeline.service.spec.ts`（既有 tests 不修改邏輯，只確認通過）
- 新增 template integration test cases

**驗收標準**：

- [ ] 執行 `npx jest --testPathPatterns "chat-pipeline.service"` → 全部通過（含 001 舊 tests）
- [ ] 新增 template 路徑 test case：mock `answerType='template'` 的 knowledge entry，驗證 LLM 未被呼叫
- [ ] 新增 rag+template 路徑 test case

**依賴**：TM-002  
**相容性**：目標確保 001 tests 全通過

---

### Workstream E：Diagnosis Foundation

---

### DG-001 `CORE`

**標題**：DiagnosisModule skeleton — 介面與類型定義

**目標**：建立 `src/diagnosis/` 模組骨架，定義 `IDiagnosisService` 介面與 `DiagnosisContext` / `DiagnosisQuestion` 類型。

**產出物**：

- `src/diagnosis/diagnosis.module.ts`
- `src/diagnosis/diagnosis.service.ts`（骨架）
- `src/diagnosis/interfaces/diagnosis-service.interface.ts`
- `src/diagnosis/types/diagnosis-context.type.ts`

**IDiagnosisService 方法**（設計見 design.md §11.3）：

- `initFlow(conversationId, flowId, questions)`
- `getNextQuestion(conversationId, language)`
- `recordAnswer(conversationId, fieldKey, answer)`
- `isComplete(conversationId)`
- `getCollectedAnswers(conversationId)`

**驗收標準**：

- [ ] TypeScript 編譯無錯誤
- [ ] `DiagnosisModule` 可被 `AppModule` import 而不報錯
- [ ] `DiagnosisContext` / `DiagnosisQuestion` 類型完整（含 flowId / currentStep / pendingQuestions / collectedAnswers / isComplete）

**依賴**：無  
**相容性**：不修改任何現有檔案

---

### DG-002 `CORE`

**標題**：DiagnosisService 實作 — 狀態機讀寫 + ConversationService 整合

**目標**：實作 `IDiagnosisService` 的所有方法，透過 `ConversationService` 讀寫 `Conversation.diagnosisContext` JSONB，不直接操作 Prisma。

**涉及檔案**：

- `src/diagnosis/diagnosis.service.ts`（實作）
- `src/conversation/conversation.service.ts`（新增 getDiagnosisContext / updateDiagnosisContext）
- `src/conversation/conversation.repository.ts`（新增對應 repo 方法）

**新增 ConversationService 方法**：

```typescript
getDiagnosisContext(conversationId: number): Promise<DiagnosisContext | null>
updateDiagnosisContext(conversationId: number, context: DiagnosisContext): Promise<void>
```

**驗收標準**：

- [ ] `initFlow()` 初始化 DiagnosisContext 並寫入 DB（透過 ConversationService）
- [ ] `getNextQuestion()` 回傳 `pendingQuestions[0]`（若 isComplete 回傳 null）
- [ ] `recordAnswer()` 更新 `collectedAnswers` 並推進 `currentStep`
- [ ] `isComplete()` 當 `pendingQuestions` 全部回答後回傳 true
- [ ] Unit tests：5 個狀態機轉換測試（init / getNext / record / complete / getAnswers）

**依賴**：DG-001  
**相容性**：ConversationService 新增方法不影響現有方法

---

### DG-003 `TEST`

**標題**：DiagnosisService unit tests + Phase 4 前置驗證

**目標**：完整覆蓋 DiagnosisService 的 unit tests，並記錄 Phase 4 可直接擴充的介面文件。

**涉及檔案**：

- `src/diagnosis/diagnosis.service.spec.ts`（新增）

**測試案例（至少 8 個）**：

- 初始化問診流程（initFlow）
- 取得下一個問題
- 記錄答案後問題推進
- 所有問題回答完後 isComplete() = true
- 問診未初始化時 getNextQuestion() 回傳 null
- getCollectedAnswers() 回傳正確 map
- 多輪 recordAnswer 累積正確
- 已完成問診 getNextQuestion() 仍回傳 null

**驗收標準**：

- [ ] `npx jest --testPathPatterns "diagnosis.service"` ≥ 8 個測試通過
- [ ] DiagnosisService mock injection 正常（ConversationService mock）

**依賴**：DG-002  
**相容性**：純測試

---

## 5. Delta Phase D：Regression / Rollout Readiness

> **波段目標**：建立 Golden FAQ regression fixtures（zh-TW 20 筆 + en 10 筆 + intent 5+ 種），整合進 CI，確保 feature flag 切換前後命中率不退步，並作為 002 正式 rollout 的驗收門檻。

### Workstream F：Regression & Benchmark

---

### RG-001 `TEST`

**標題**：Golden FAQ fixtures — zh-TW 版本（20 筆）

**目標**：建立 20 筆繁體中文常用 FAQ 問法的 golden fixture，驗證 retrieval 命中率不退步。

**產出物**：

- `test/fixtures/faq-zh.fixtures.ts`

**Fixture 格式**：

```typescript
export const FAQ_ZH_FIXTURES: Array<{
  query: string;
  language: string;
  expectedSourceKey: string; // 期望命中的 KnowledgeEntry.sourceKey（top-3 中）
  expectedAction: 'answer' | 'fallback';
}> = [
  {
    query: '請問你們有哪些螺絲類別',
    language: 'zh-TW',
    expectedSourceKey: 'screw-categories',
    expectedAction: 'answer',
  },
  // ... 共 20 筆
];
```

**涵蓋問法類型**：

- 直接問句（「你們的螺絲規格是什麼」）
- 問法變體（「請問」/「想知道」/「能告訴我」開頭）
- 全形標點輸入
- 混合中英文（「M3 螺絲 size」）
- 縮短問句（「M3 不鏽鋼」）

**驗收標準**：

- [ ] 20 筆 fixtures 搭配當前 seed 資料，`retrievalService.retrieve()` top-3 命中率 ≥ 95%（19/20 以上）
- [ ] Fixtures 文件有清楚的 `expectedSourceKey` 對應

**依賴**：KS-003  
**相容性**：純測試 fixtures，不修改實作

---

### RG-002 `TEST`

**標題**：Golden FAQ fixtures — en 版本（10 筆）+ intent fixtures（5+ 種）

**目標**：建立英文 FAQ fixtures 與 intent fixtures，驗證中英雙語與 intent 準確率。

**產出物**：

- `test/fixtures/faq-en.fixtures.ts`
- `test/fixtures/intent.fixtures.ts`

**Intent fixtures 涵蓋**：

- `product-inquiry`（至少 3 個問法）
- `pricing-inquiry`（至少 2 個）
- `contact-inquiry`（至少 2 個）
- `general-faq`（至少 2 個）
- `product-diagnosis`（至少 2 個）

**驗收標準**：

- [ ] en fixtures 10 筆，top-3 命中率 ≥ 90%
- [ ] intent fixtures：各 intent 類型準確率 ≥ 85%（5 種 × 2-3 問法，整體準確率）

**依賴**：RG-001、IG-005  
**相容性**：純測試

---

### RG-003 `TEST` `OPS`

**標題**：Regression test suite CI 整合

**目標**：將 golden fixtures regression tests 整合進 CI，防止 ranking / query rules 修改後靜默退步。

**產出物**：

- `test/regression/retrieval.regression.spec.ts`（使用 RG-001 / RG-002 fixtures）
- `test/regression/intent.regression.spec.ts`
- CI 設定更新（確保 regression suite 在 CI 執行）

**Retrieval regression test 結構**：

```typescript
describe('Retrieval regression - FAQ zh-TW golden fixtures', () => {
  it.each(FAQ_ZH_FIXTURES)(
    'should hit expected entry for: %s',
    async ({ query, language, expectedSourceKey }) => {
      const results = await retrievalService.retrieve({ query, language });
      const sourceKeys = results.slice(0, 3).map(r => r.entry.sourceKey);
      expect(sourceKeys).toContain(expectedSourceKey);
    },
  );
});
```

**驗收標準**：

- [ ] `npx jest --testPathPatterns "regression"` 在初始 seed 下全通過
- [ ] regression suite 在 `feature.query_analysis_enabled=false`（001 行為）通過
- [ ] regression suite 在 `feature.query_analysis_enabled=true`（002 新 analyzer）通過，且命中率 ≥ 95%

**依賴**：RG-001、RG-002、QA-005  
**相容性**：僅新增 test files，不修改 src/

---

---

## 6. 任務摘要表

| 任務 ID | Delta Phase | 標記  | 標題                                             | 依賴                   | 狀態 |
| ------- | ----------- | ----- | ------------------------------------------------ | ---------------------- | ---- |
| KS-001  | A           | DATA  | KnowledgeEntry schema migration                  | —                      | ✓    |
| KS-002  | A           | DATA  | IntentTemplate schema migration                  | KS-001                 | ✓    |
| KS-003  | A           | DATA  | Seed 腳本 sourceKey upsert                       | KS-001                 | ✓    |
| KS-004  | A           | ADMIN | Admin Knowledge DTO/Service 擴充                 | KS-001、KS-003         | ✓    |
| QA-001  | B           | CORE  | QueryAnalysisModule skeleton + 介面              | —                      | ✓    |
| QA-002  | B           | CORE  | RuleBasedQueryAnalyzer 預設實作                  | QA-001                 | ✓    |
| QA-003  | B           | CORE  | DbQueryRuleProvider + query_rules table          | QA-001、QA-002         | □    |
| QA-004  | B           | CORE  | GlossaryExpansionProvider + RankProfileProvider  | QA-001~003             | □    |
| QA-005  | B           | INTG  | Chat Pipeline 整合 QueryAnalysis（feature flag） | QA-001~004             | ✓    |
| IG-001  | B           | ADMIN | AdminSystemConfig 落地 CRUD + invalidate         | KS-001                 | ✓    |
| IG-002  | B           | ADMIN | admin/intent API + cache invalidation            | KS-002、IG-001         | ✓    |
| IG-003  | B           | ADMIN | admin/glossary API + cache invalidation          | IG-001                 | ✓    |
| IG-004  | B           | OPS   | Ranking Profile SystemConfig seed                | IG-001                 | ✓    |
| IG-005  | B           | CORE  | IntentService 三層路由重構                       | QA-001、IG-002         | ✓    |
| IG-006  | B           | CORE  | GlossaryExpansionProvider 整合 IntentService     | QA-004、IG-005         | ✓    |
| IG-007  | B           | TEST  | Intent / Glossary admin unit tests               | IG-002、IG-003         | ✓    |
| TM-001  | C           | CORE  | AnswerTemplateResolver 四路徑邏輯                | KS-001、QA-001         | □    |
| TM-002  | C           | INTG  | Chat Pipeline 整合 TemplateResolver              | TM-001                 | □    |
| TM-003  | C           | TEST  | Template 整合測試 + backward compat              | TM-002                 | □    |
| DG-001  | C           | CORE  | DiagnosisModule skeleton + 介面                  | —                      | □    |
| DG-002  | C           | CORE  | DiagnosisService 實作 + ConversationService 整合 | DG-001                 | □    |
| DG-003  | C           | TEST  | DiagnosisService unit tests                      | DG-002                 | □    |
| RG-001  | D           | TEST  | Golden FAQ fixtures zh-TW（20 筆）               | KS-003                 | □    |
| RG-002  | D           | TEST  | Golden FAQ fixtures en + intent fixtures         | RG-001、IG-005         | □    |
| RG-003  | D           | TEST  | Regression suite CI 整合                         | RG-001、RG-002、QA-005 | □    |

**總計**：25 個任務（KS：4 / QA：5 / IG：7 / TM：3 / DG：3 / RG：3）  
**Delta Phase 分布**：A（4）/ B（12）/ C（6）/ D（3）
