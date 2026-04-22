# 震南 AI 客服後端 — 002 增量實作計畫

**版本**：1.0.0 | **建立日期**：2026-04-21 | **狀態**：Draft  
**承接文件**：`specs/002-query-analysis-foundation/spec.md` v1.0.0、`design.md` v1.0.0  
**前置計畫**：`specs/001-ai-chatbot-backend-system/plan.md` v1.4.0

---

## 0. 本計畫的性質

**這是一份 Delta Plan（增量計畫），不是新專案**。

- 001 的 Phase 0 ~ Phase 3 已完成實作，94 個測試通過
- 002 在 001 基礎上演進，不重置 Phase 0 ~ 3 的任何進度
- 002 的目的是在 001 Phase 4（問診式推薦）啟動前，補齊產品級基礎能力
- 002 的任務可以與 001 Phase 6（後台管理 API）、Phase 7（品質補強）部分平行執行

**執行前提**：

- 001 Phase 0 ~ 3 已完成（基線）
- 全部 94 個 001 測試持續通過（CI 強制）

---

## 1. 計畫目標

| #    | 目標                                                                                 |
| ---- | ------------------------------------------------------------------------------------ |
| PG-1 | 建立 QueryAnalysisModule，讓 Query 理解從 hardcoded static utility 升級為可治理模組  |
| PG-2 | 正式化 KnowledgeEntry schema，為 Phase 4 問診比對提供結構化基礎                      |
| PG-3 | IntentService 三層分流，提升 intent 識別準確率，達成 spec.md §4 的 ≥85% 目標         |
| PG-4 | 補齊 admin 治理入口（intent / glossary / system-config），讓規則管理脫離 code change |
| PG-5 | Template Resolver 策略，讓類別型問題走 template-first 而非全走 LLM                   |
| PG-6 | DiagnosisService 初版，為 Phase 4 問診流程奠定基礎                                   |
| PG-7 | Regression golden fixtures，防止 ranking / query 調整造成已知 FAQ 命中退步           |

---

## 2. Workstream 規劃

002 分為以下四個 workstream，可部分平行，但有明確依賴關係：

```
Workstream A：Knowledge Schema（優先）
  ↓ 完成後 Workstream B/C/D 均可受益
Workstream B：QueryAnalysisModule
  ↓ 完成後 Workstream C 可升級至三層路由
Workstream C：Intent / Glossary / Admin
  ↓ 完成後 Workstream D 有更準確的 intentLabel
Workstream D：Template Strategy + Diagnosis Foundation
```

---

## 3. 各 Workstream 里程碑

---

### Workstream A — Knowledge Schema Formalisation

**目的**：讓 KnowledgeEntry 從 MVP 結構升級為產品級 schema，提供後續所有 Workstream 的結構基礎。

**主要產出物**：

- Prisma migration（新增 sourceKey / category / answerType / templateKey / faqQuestions / crossLanguageGroupKey / structuredAttributes）
- Seed 腳本更新（使用 sourceKey upsert）
- Admin Knowledge DTO / Service 擴充（支援新欄位 CRUD）
- Regression 驗證（既有 seed 資料在新 schema 下正常運作）

**完成條件**：

- [ ] Migration 非破壞性通過（`answerType` default `'rag'`，其他欄位 nullable）
- [ ] 所有既有 001 tests 仍通過
- [ ] Seed 腳本使用 `sourceKey` upsert 正常執行（`prisma db seed` 無錯誤）
- [ ] Admin Knowledge API 新欄位的 CRUD unit tests 通過

**風險**：

- schema 膨脹：僅新增必要欄位，`structuredAttributes` 保持 untyped Json（Phase 4 再正式化）
- seed 腳本 sourceKey 重複：需在 seed 設計時確保 sourceKey + language 唯一

---

### Workstream B — QueryAnalysisModule

**目的**：將 `QueryNormalizer` 靜態 utility 重構為可注入、可治理的 `QueryAnalysisModule`，支援 DB rules、glossary expansion、profile selection。

**主要產出物**：

- `src/query-analysis/` 模組（IQueryAnalyzer / RuleBasedQueryAnalyzer / ITokenizer / RuleBasedTokenizer）
- `DbQueryRuleProvider`（DB 取 query rules，帶 cache）
- `GlossaryExpansionProvider`（從 IntentService cache 展開）
- `SystemConfigRankProfileProvider`（從 SystemConfig 讀取 ranking profile）
- AnalyzedQuery type 定義
- Chat Pipeline 整合（feature flag 控制）
- Golden FAQ fixtures（20 筆 zh-TW + 10 筆 en）
- Regression test suite

**完成條件**：

- [ ] `QueryAnalysisService.analyze()` 產出完整 AnalyzedQuery 物件（含 terms / expandedTerms / selectedProfile）
- [ ] `feature.query_analysis_enabled=false` 時行為與 001 完全一致（向後相容測試通過）
- [ ] `feature.query_analysis_enabled=true` 時 golden FAQ fixtures regression 通過（≥ 95% top-3 命中）
- [ ] Query Analysis P90 延遲 ≤ 20ms（unit benchmark）
- [ ] 全部 001 tests 仍通過

**風險**：

- 新 analysis pipeline 可能改變某些 FAQ query 的 normalized form，導致命中退步 → 用 feature flag 隔離，regression 確認後再切換
- RuleBasedTokenizer 中文分詞效果有限（phrase detection 依賴位置，不依賴語意）→ 002 接受此限制，Phase 後期再評估 jieba

---

### Workstream C — Intent / Glossary / Admin Governance

**目的**：補齊 admin 治理入口（intent / glossary / system-config），讓規則管理正式產品化；升級 IntentService 至三層路由。

**主要產出物**：

- `src/admin/intent/` API（CRUD + cache invalidation）
- `src/admin/glossary/` API（CRUD + cache invalidation）
- `AdminSystemConfigService` 正式落地（不再是 NotImplementedException）
- `AdminSystemConfigController` PATCH /api/v1/admin/system-config/:key
- `IntentService` 三層路由重構（Layer 1: intentHints / Layer 2: expandedTerms / Layer 3: category fallback）
- `IntentTemplate` 新增 `isActive` / `category` 欄位（migration）
- Intent fixture 測試集（5+ 種 intent）

**完成條件**：

- [ ] `admin/intent` CRUD 正常，操作後 cache 立即更新（不需重啟）
- [ ] `admin/glossary` CRUD 正常，操作後 cache 立即更新
- [ ] `admin/system-config` PATCH 正常，修改後 `SystemConfigService.getNumber()` 立即反映
- [ ] IntentService 三層路由 unit tests 通過（5+ intent 類型 fixture）
- [ ] `isActive=false` 的 template 在 detect() 時被跳過

**風險**：

- IntentService 三層路由重構，原有 detect() 行為可能有細微差異 → 保留向後相容路徑（analyzedQuery? 為可選參數），現有呼叫路徑不改變

---

### Workstream D — Template Strategy + Diagnosis Foundation

**目的**：新增 AnswerTemplateResolver 決定回答路徑；建立 DiagnosisService 初版作為 Phase 4 前置。

**主要產出物**：

- `src/template/` 模組（AnswerTemplateResolver）
- TemplateResolution 類型定義
- Chat Pipeline 整合（template / rag+template / rag / llm 四路徑）
- `src/diagnosis/` 模組（DiagnosisService 初版、IDiagnosisService 介面）
- DiagnosisContext 類型定義
- ConversationService 新增 `getDiagnosisContext()` / `updateDiagnosisContext()` 方法
- Unit tests for DiagnosisService 狀態機
- Unit tests for AnswerTemplateResolver 四路徑

**完成條件**：

- [ ] AnswerTemplateResolver 四路徑（template / rag+template / rag / llm）unit tests 全通過
- [ ] Chat Pipeline template 路徑產出 deterministic（相同輸入相同輸出）
- [ ] DiagnosisService `getNextQuestion` / `recordAnswer` / `isComplete` 可獨立 unit test
- [ ] `Conversation.diagnosisContext` 的讀寫經由 DiagnosisService（不直接操作 JSONB in pipeline）
- [ ] 全部 001 tests 仍通過

**風險**：

- template 策略與 PromptBuilder 的邊界可能模糊 → template 路徑繞過 PromptBuilder，直接產出 content；PromptBuilder 只在 rag/llm 路徑使用
- DiagnosisService 初版設計可能需要在 Phase 4 重構 → 002 刻意保持介面最小化（5 個方法），Phase 4 在此基礎上擴充

---

## 4. 依賴關係圖

```
001 Phase 0~3（已完成）
  │
  ▼
[A] Knowledge Schema Formalisation
  ├──→ [B] QueryAnalysisModule（需要 GlossaryTerm 資料）
  └──→ [C] Intent / Glossary / Admin Governance（需要 KnowledgeEntry.category）
         │
         ▼
      [B] QueryAnalysisModule（需要 IntentService expansion）
         │
         ▼
      [D] Template Strategy + Diagnosis Foundation
              │
              ▼
        001 Phase 4（問診完整實作）
```

**平行執行機會**：

- A 完成後，B 和 C 可平行開始
- C 完成後（admin/system-config 落地），B 的 ranking profile 功能可接著推
- D 依賴 B（TemplateResolver 需要 AnalyzedQuery）和 C（intent routing 輸出）

---

## 5. 與 001 Phase 6/7 的關係

| 001 任務                                                | 與 002 的關係                                                                          |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Phase 6：後台管理 API（Dashboard / Lead / Ticket 查詢） | 可平行執行，無依賴                                                                     |
| Phase 6：知識庫後台 CRUD                                | 002 Workstream A 的 schema 演進會影響知識庫 DTO；建議 A 先完成再做 Phase 6 知識庫 CRUD |
| Phase 7：品質補強 / 驗收準備                            | 002 的 regression fixtures 可作為 Phase 7 的驗收測試素材                               |

---

## 6. 風險清單

| 風險                                               | 可能性 | 影響 | 緩解策略                                                                            |
| -------------------------------------------------- | ------ | ---- | ----------------------------------------------------------------------------------- |
| QueryAnalysis 使某些 FAQ 命中退步                  | 中     | 高   | feature flag 隔離；regression fixtures 確認後才切換                                 |
| KnowledgeEntry schema 演進破壞 seed 腳本           | 低     | 中   | 所有新欄位 nullable/default；seed 使用 upsert by sourceKey                          |
| IntentService 三層路由引入細微行為差異             | 低     | 中   | `analyzedQuery?` 為可選參數；regression tests 保護                                  |
| AdminSystemConfig 落地影響 SystemConfig cache 行為 | 低     | 低   | 明確 invalidate 呼叫鏈；integration test 驗證                                       |
| template 策略與 PromptBuilder 邊界不清             | 中     | 中   | design doc §8 明確定義路徑分叉點；template 路徑完全繞過 PromptBuilder               |
| 過度設計 DiagnosisService                          | 中     | 中   | 介面最小化（5 個方法）；Phase 4 再擴充，不在 002 預先建置 Phase 4 邏輯              |
| 002 與 Phase 4 邊界模糊                            | 低     | 中   | spec §6.2 明確 Phase 4 in 002 out-of-scope；DiagnosisService 002 只做介面與基礎讀寫 |

---

## 7. 里程碑總覽

| 里程碑                           | 完成條件                                                        | 預期產出                                |
| -------------------------------- | --------------------------------------------------------------- | --------------------------------------- |
| M1：Knowledge Schema 就緒        | migration 通過；seed 正常；001 tests 全通過                     | 新 schema + 更新 seed                   |
| M2：QueryAnalysisModule 骨架     | IQueryAnalyzer / 預設實作 / AnalyzedQuery type ready            | 可獨立 unit test 的 module              |
| M3：Query Rules DB 治理          | DbQueryRuleProvider 可用；admin system-config 落地              | rules 來自 DB；admin 可改規則不需重啟   |
| M4：Ranking Profile 可配置       | SystemConfig 管理 ranking weights；regression fixtures 通過     | 20 FAQ golden fixtures 全通過           |
| M5：Admin Intent / Glossary 治理 | admin/intent + admin/glossary API 就緒；cache invalidation 正常 | 管理者可從 admin 管理 intent / glossary |
| M6：IntentService 三層路由       | 三層路由 unit tests 通過；intent fixture 準確率 ≥85%            | 更準確的 intent 分流                    |
| M7：Template Resolver 就緒       | 四路徑 unit tests 通過；Pipeline 整合完成                       | template 路徑 deterministic             |
| M8：Diagnosis Service 初版       | IDiagnosisService unit tests 通過；ConversationService 整合     | Phase 4 前置基礎就緒                    |
| M9：Regression Benchmark 就緒    | 20 zh-TW + 10 en fixtures 在 CI 通過                            | 防止 ranking 退步的 CI 守門             |

---

## 8. 測試與驗證策略

### 8.1 守門測試（Gate Tests）

每個 Workstream 完成前必須：

1. 執行 001 全部 tests（94 個）確認全通過
2. 執行新增的 unit tests
3. 執行 regression fixtures（M4 就緒後）

### 8.2 Integration Testing

每個 Workstream 完成後執行：

- Admin API → cache invalidation → service 行為的 integration test
- Chat Pipeline feature flag = false vs. true 的行為對比

### 8.3 Backward Compatibility Test Matrix

| 場景                                                               | 驗證方式                       |
| ------------------------------------------------------------------ | ------------------------------ |
| `answerType='rag'` 既有條目行為不變                                | unit test                      |
| `feature.query_analysis_enabled=false` 時 Pipeline 行為與 001 一致 | unit test（mock feature flag） |
| `detect(input, language)` 不傳 `analyzedQuery` 時行為與 001 一致   | unit test                      |
| 所有 001 seed 資料在新 schema 下正常顯示                           | seed + e2e                     |

---

## 9. 完成標準（Definition of Done）

002 整體完成的定義：

1. M1 ~ M9 全部達成
2. 全部 001 原有 tests 持續通過（≥ 94 tests）
3. 002 新增 unit tests 覆蓋所有新模組的核心路徑
4. Regression benchmark suite 在 CI 通過
5. Admin API（intent / glossary / system-config）全部落地（不再有 NotImplementedException）
6. Phase 4 可在 002 基礎上直接啟動 DiagnosisService 擴充，不需從零設計
7. `feature.query_analysis_enabled=true` 在 golden fixtures 上命中率 ≥ 95%（top-3）
