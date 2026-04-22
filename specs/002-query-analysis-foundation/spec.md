# 震南 AI 客服後端 — 002 增量規格：Query Analysis Foundation

**版本**：1.0.0 | **建立日期**：2026-04-21 | **狀態**：Draft  
**前置文件**：`specs/001-ai-chatbot-backend-system/spec.md` v1.7.0  
**本文件角色**：001 的增量演進規格，為 Phase 4 前補齊產品級基礎能力

---

## 0. 文件定位與閱讀說明

本文件是 001 規格的**增量版本**，不是全案重寫。

閱讀本文件前，請先閱讀：

- `specs/001-ai-chatbot-backend-system/spec.md`（基線功能需求）
- `specs/001-ai-chatbot-backend-system/design.md`（基線技術設計）

本文件**只定義** 001 未涵蓋、或 001 在 MVP 階段刻意延後的能力。  
本文件**不重複**描述 001 已明確定義且已完成實作的功能。

---

## 1. 002 的定位：為什麼在 Phase 4 前要先做 002

### 1.1 001 解決了什麼

001 建立了可運作的 AI 客服後端 MVP：

- Chat Pipeline（SSE 主流程、意圖識別、RAG 擷取、LLM 呼叫）
- 安全防護（Prompt Guard、黑名單、機密保護）
- 基礎知識管理（KnowledgeEntry CRUD、語言/別名支援）
- IntentService（關鍵字 rule-based 骨架）
- QueryNormalizer（FAQ 友善前處理）
- 稽核日誌、會話管理、降級模式
- 中英文雙語基本支援

### 1.2 001 的 MVP 限制

001 刻意採取 MVP 姿態，保留以下已知債務：

| 限制                          | 具體表現                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------- |
| Query 分析 hardcoded          | `QueryNormalizer` 是靜態 utility，規則寫死在程式碼；無 DB 治理、無 cache invalidation、無 rollout |
| 意圖識別僅是骨架              | `IntentService.detect()` 只做 substring keyword match；`isHighIntent()` 永遠回傳 false            |
| Glossary 展開過於簡單         | 把同義詞附加到輸入字串後再做 substring match，缺乏正式詞彙展開架構                                |
| KnowledgeEntry 結構不夠產品級 | 欄位存在但無 `sourceKey`（穩定 identity）、無 FAQ 問句變體治理、無跨語系配對機制                  |
| 沒有 ranking profile 治理     | 評分常數在 `RETRIEVAL_SCORING` 常數檔，無法透過 admin 動態調整                                    |
| 沒有 admin/intent 治理入口    | IntentTemplate / GlossaryTerm 有 DB 與快取，但沒有正式 admin API                                  |
| 沒有 template 策略            | 類別型問題（如規格查詢）全走 LLM，缺乏 template-first 回答策略                                    |
| 沒有 Diagnosis Service        | `Conversation.diagnosisContext` 已預留但無對應 service / module                                   |
| SystemConfig admin 未落地     | `AdminSystemConfigService` 仍是 skeleton，`NotImplementedException`                               |

### 1.3 為什麼 Phase 4 前必須先做 002

Phase 4 的核心目標是「問診式產品推薦」。問診流程高度依賴：

1. **細緻的 intent routing**：問診要知道訪客問的是哪類問題，才能決定問診路徑
2. **結構化的 knowledge schema**：推薦產品需要從 knowledge entry 讀取結構化屬性（規格、類別、適用場景）
3. **可靠的 query 理解**：問診中間步驟需要準確抽取 term/phrase，才能比對產品屬性
4. **template-first 策略**：問診回覆有固定格式，不適合每次都走 LLM free-form 生成
5. **Diagnosis Service**：Phase 4 需要一個狀態機來管理問診進度，目前完全缺位

若直接進入 Phase 4 而不先做 002，會遭遇：

- intent 分流不夠細 → 問診路徑觸發不準確
- knowledge schema 缺乏結構 → 無法做屬性匹配型推薦
- query 分析能力不足 → 中間步驟需要手工 hack
- 沒有 template → LLM 生成問診問題品質不可控
- 沒有 Diagnosis Service → Phase 4 從零建，無任何前置基礎

---

## 2. 002 的四個主軸

002 以下列優先順序推進（依賴關係決定順序，非重要性排序）：

```
[1] KnowledgeEntry 結構化
      ↓ 提供 structured schema，讓 query analysis 有結構可比對
[2] Query Analysis / Query Understanding 產品化
      ↓ 產出 analyzed query，讓 intent 分流更準確
[3] Intent 分流更細
      ↓ 細分 intent routing，讓 template 策略有路徑依據
[4] 類別型問題的 Template 策略
```

---

## 3. 002 的新主題：Query Analysis / Query Understanding

### 3.1 定義

**Query Analysis**（查詢理解）是指在收到使用者原始輸入後、送入 Retrieval 或 Intent 判斷前，對輸入進行結構化解析的過程，產出一個**分析後的查詢物件（AnalyzedQuery）**。

與 001 的 `QueryNormalizer` 的差異：

| 面向      | 001 `QueryNormalizer`       | 002 Query Analysis                          |
| --------- | --------------------------- | ------------------------------------------- |
| 形式      | 靜態 utility class          | 可注入的 NestJS Module                      |
| 輸入/輸出 | string → string             | string → AnalyzedQuery 物件                 |
| 規則管理  | hardcoded                   | DB + cache，可 admin 治理                   |
| 詞彙展開  | 無（glossary 在 intent 層） | 正式 expansion pipeline                     |
| 可插拔性  | 無                          | `IQueryAnalyzer` 介面，可替換實作           |
| 可觀測性  | 無                          | matchedRules / selectedProfile / terms 輸出 |
| 測試能力  | 單元 OK                     | 單元 + regression fixtures                  |

### 3.2 Query Analysis 與其他模組的關係

```
使用者輸入
    │
    ▼
┌──────────────────────────┐
│     QueryAnalysisModule  │
│  - 規則化前處理           │
│  - 詞彙抽取               │
│  - 同義詞展開             │
│  - ranking profile 選取  │
└──────────┬───────────────┘
           │  AnalyzedQuery
    ┌──────┴──────┐
    ▼             ▼
IntentService  RetrievalService
 (intent hints  (使用 normalizedQuery
  參與決策)       + terms + profile)
    │
    ▼
PromptBuilder
(使用 intentLabel +
 selectedProfile 選 template)
```

### 3.3 為什麼它不能再只是 static utility

1. **規則需要 admin 治理**：stop words、noise words、展開規則不應寫死；管理者需要從 admin 介面增刪規則，並即時生效
2. **Ranking profile 需要可切換**：FAQ 查詢 vs. 規格查詢 vs. 問診查詢的 ranking 策略不同，需要 profile 概念
3. **詞彙展開需要正式化**：glossary expansion 目前僅在 IntentService 做，retrieval 層看不到展開後的 terms
4. **可觀測性**：debug 時需要知道哪條規則被觸發、哪個 profile 被選取、哪些 terms 被抽取
5. **可測試性**：需要 regression fixtures 確保修改規則不會讓現有 FAQ 命中退步

---

## 4. 功能需求（FR）— 新增於 002

> 本節僅列 002 新增或升級的 FR，不重抄 001 FR-001 ~ FR-077。

### FR-QA-001：AnalyzedQuery 輸出結構

系統應能將原始使用者輸入轉換為結構化的 `AnalyzedQuery`，包含：

- `rawQuery`：原始未處理輸入
- `normalizedQuery`：規則化後的查詢字串
- `language`：偵測到的語言（`zh-TW` | `en`）
- `tokens`：分詞結果（rule-based）
- `terms`：關鍵詞清單（高信心度，用於 reranking）
- `phrases`：片語清單（多詞組合）
- `expandedTerms`：同義詞展開後的詞彙清單
- `matchedRules`：命中的 query rule ID / name 清單
- `selectedProfile`：所選 ranking profile key
- `intentHints`：從 query 分析推導出的 intent 候選清單
- `debugMeta`：除錯用 metadata（processing time、每步驟結果）

**驗收**：所有 SSE `event: done` 不需要回傳 `AnalyzedQuery` 給前端；debug metadata 只寫入 AuditLog，不暴露 API response。

### FR-QA-002：Query 規則管理

系統應支援透過 DB 管理以下 query rules，並提供 admin API 進行 CRUD：

- Stop words（中英文分開管理）
- Noise words（前處理過濾詞，與 stop words 分開）
- Question-shell patterns（替代目前 hardcoded regex）
- Term weights（特定詞彙的 retrieval 權重 override）

**驗收**：新增 / 修改 query rules 後呼叫 cache invalidation，下一筆請求即可套用新規則；不需重啟 server。

### FR-QA-003：同義詞與詞彙展開

系統應在 Query Analysis 階段正式執行詞彙展開（glossary expansion），展開結果包含於 `expandedTerms`，並傳遞至 RetrievalService 使用。

目前在 IntentService 內的 `expandWithGlossary()` 邏輯應被正式化並移至 Query Analysis 層。

**驗收**：`expandedTerms` 出現在 AnalyzedQuery 中，RetrievalService 在 reranking 時可使用 expandedTerms 進行額外加分。

### FR-QA-004：Ranking Profile 管理

系統應支援命名式 ranking profile，包含：

- `title` / `alias` / `tag` / `content` 的評分權重
- `pg_trgm` similarity threshold
- Rerank bonus 設定（alias ILIKE bonus、tag ILIKE bonus 等）

Profile 應可透過 `SystemConfig` 或 DB table 管理，支援：

- 預設 profile（`default`）
- FAQ profile（`faq`）— 提高 alias 權重
- 問診 profile（`diagnosis`）— 提高 tag / category 權重
- Profile 選取規則：可由 intent hint 或 query 特徵決定

**驗收**：修改 ranking profile 後不需重啟 server；不同 profile 下同一筆查詢可產生不同排序結果（可用 unit test 驗證）。

### FR-QA-005：Query Analysis 可觀測性

系統應在 AuditLog 中記錄：

- 本次選取的 ranking profile
- 命中的 query rules
- 抽取的 terms / expandedTerms
- Query Analysis 處理時間（毫秒）

**驗收**：`AuditLog.eventData` 中可查到上述 debug 欄位；生產環境不影響 API 回應時間（非同步補寫）。

---

### FR-KS-001：KnowledgeEntry 結構化欄位

系統應在 `KnowledgeEntry` 新增以下欄位：

- `sourceKey`：穩定的業務識別鍵（human-readable slug，如 `screw-m3-specification`），用於跨版本、跨語言識別同一份知識條目；於 seed / migration 時設定，admin 可修改
- `category`：業務分類（如 `product-spec`、`faq-general`、`pricing`、`contact`），取代目前靠 tags 隱含的分類
- `answerType`：回答策略標記（`template` | `rag` | `rag+template` | `llm`）
- `templateKey`：若 answerType 含 template，指向 template registry 的 key
- `faqQuestions`：常見提問變體（`String[]`，目前 `aliases` 的語意子集，需正式分離）
- `crossLanguageGroupKey`：跨語系配對 group key（讓 zh-TW 與 en 版本的同一條目可被識別為同一組）
- `structuredAttributes`：產品規格屬性 JSONB（供問診比對用，Phase 4 前準備）

**驗收**：

- `sourceKey` 在同語言下唯一（unique constraint）
- `category` 有 admin CRUD；admin 知識管理 DTO 包含這些新欄位
- 既有無此欄位的條目 migration 後不受影響（全部 nullable 或有 default）

### FR-KS-002：Admin 知識管理 API 擴充

現有 `admin/knowledge/*` API 應支援：

- 依 `category` 篩選
- 依 `answerType` 篩選
- `sourceKey` 的 upsert（建立或更新）語意
- `crossLanguageGroupKey` 的設定與查詢
- `faqQuestions` 的編輯

**驗收**：CRUD 所有新欄位均可透過 admin API 操作；seed 腳本使用 `sourceKey` 做 upsert，不使用自增 ID。

### FR-KS-003：FAQ 問句變體治理

系統應提供明確機制管理 FAQ 問句變體（`faqQuestions` 欄位），區分於 `aliases`（FAQ 變體）與 `tags`（產品關鍵字）的責任邊界：

- `aliases`：主要用於 retrieval 的 ILIKE 命中（FAQ phrasings）
- `tags`：產品關鍵字、規格識別符（不含完整問句）
- `faqQuestions`：新欄位，明確儲存「訪客可能怎麼問這個問題」的完整問句形式

**驗收**：admin DTO 中三個欄位有各自獨立的 validation；seed 腳本遵守此責任邊界。

---

### FR-IT-001：IntentService 分層重構

`IntentService.detect()` 應重構為分層設計：

- **Layer 1（快速路徑）**：AnalyzedQuery 的 `intentHints`（來自 Query Analysis）作為第一層候選
- **Layer 2（template matching）**：延用目前的 keyword matching，但使用 expandedTerms 而非原始輸入
- **Layer 3（category fallback）**：若 knowledge entry 的 category 已知，用 category 推導 intent fallback

目標：intent 識別準確率從現有骨架提升至可用水準（對齊 spec.md §4 的 ≥85% 目標）。

**驗收**：有對應 intent fixture 測試（至少涵蓋 5 種常見 intent）；`isHighIntent()` 仍為 Phase 4 任務，002 不動。

### FR-IT-002：Admin Intent Template 治理入口

系統應提供 `admin/intent/*` REST API，用於：

- 列出所有 IntentTemplate（含 keywords、priority）
- 建立新的 IntentTemplate
- 更新 IntentTemplate（keywords、labels、templates、priority）
- 停用 / 啟用 IntentTemplate（`isActive` 欄位）
- 觸發 IntentService cache invalidation

**驗收**：操作後 cache 即時更新（不需重啟）；有對應 unit test。

### FR-IT-003：Admin Glossary 治理入口

系統應提供 `admin/glossary/*` REST API，用於：

- 列出所有 GlossaryTerm（含 synonyms、intentLabel）
- 建立新的 GlossaryTerm
- 更新 GlossaryTerm（synonyms、intentLabel）
- 刪除 GlossaryTerm
- 觸發 IntentService cache invalidation

**驗收**：CRUD 操作後 cache 即時更新；有對應 unit test。

---

### FR-TM-001：Template Resolver

系統應提供 `AnswerTemplateResolver`（或等價機制），根據 KnowledgeEntry.templateKey 或 IntentTemplate 的 `templateZh` / `templateEn`，決定回答是否走 template-first 策略。

Template 策略規則（按 `answerType`）：

- `template`：直接回傳 template 填空，不呼叫 LLM
- `rag+template`：先做 RAG 擷取，將知識條目內容填入 template，不走 free-form LLM
- `rag`：現有 RAG + LLM 策略（001 現狀）
- `llm`：直接走 LLM（無 RAG 約束，保留作為特殊用途）

**驗收**：Chat Pipeline 在 RAG 命中後，可依 `answerType` 決定是否跳過 LLM 呼叫；有 unit test 涵蓋各 answerType 路徑。

### FR-TM-002：Template 多語系支援

系統的 template 策略應完整支援 zh-TW / en 雙語，使用現有 `IntentTemplate.templateZh` / `templateEn`，或未來新增的獨立 template registry。

**驗收**：template 選取應依 `AnalyzedQuery.language` 回傳對應語言版本。

---

### FR-SC-001：AdminSystemConfig 落地

`AdminSystemConfigService` 不再是 NotImplementedException 骨架，正式實作：

- 列出所有 SystemConfig entries
- 更新單一 key 的 value
- 觸發 SystemConfigService cache invalidation

**驗收**：`GET/PATCH /api/v1/admin/system-config` 可正常操作；修改後 `SystemConfigService.getNumber()` / `getString()` 立即反映新值（不需重啟）。

### FR-SC-002：Ranking Profile 作為 SystemConfig key

Ranking profile 的 title/alias/tag/content 權重，以及 trgm threshold / bonus，應可透過 SystemConfig 管理（使用明確的 key 命名規範，如 `ranking.default.title_boost`）。

**驗收**：修改 `ranking.*.title_boost` 類的 SystemConfig key 後，下一次 retrieval 使用新權重；有 unit test 驗證。

### FR-SC-003：Feature Flag / Rollout Support

系統應支援基礎的 feature flag 機制（透過 SystemConfig 的特定 key 命名規範），用於：

- 啟用 / 停用 Query Analysis 新功能（`feature.query_analysis_enabled`）
- 選擇 ranking profile 決策模式（`feature.profile_selection_mode`: `rule-based` | `static`）

**驗收**：可透過 SystemConfig admin API 切換 feature flag；切換後不需重啟；有 unit test。

---

### FR-DG-001：Diagnosis Service 初版

系統應新增 `DiagnosisService`（`diagnosis.module.ts`），負責：

- 讀取 / 寫入 `Conversation.diagnosisContext`（JSONB）
- 管理問診狀態機（待問問題清單、已蒐集答案）
- 提供 `getNextQuestion()` / `updateAnswer()` / `isComplete()` 介面
- 與 `ConversationService` 整合（不直接操作 DB，透過 repository）

**驗收**：

- DiagnosisService 可獨立於 Chat Pipeline 進行單元測試
- `Conversation.diagnosisContext` 的讀寫經由 DiagnosisService，不直接在 Pipeline 操作 JSONB
- Phase 4 可直接在此基礎上擴充，不需從零設計

---

## 5. 非功能需求（NFR）— 002 補充

> 以下 NFR 補充 001 NFR 中未明確涵蓋的面向。

### NFR-QA-001：可配置性（Configurability）

Query rules、ranking weights、glossary、intent keywords，必須全部以 DB 為單一權威來源，admin 可在不重啟 server 的情況下修改並立即生效。

**目標**：任何 query/retrieval/intent 相關的業務邏輯變更，不需要修改程式碼或部署新版本。

### NFR-QA-002：可替換性（Replaceability）

所有 Query Analysis 元件應以介面抽象：`IQueryAnalyzer`、`ITokenizer`、`IQueryRuleProvider`、`IQueryExpansionProvider`。

預設實作為 rule-based；未來可替換為 jieba / CKIP tokenizer 或外部 NLP 服務，**不修改 Chat Pipeline 主流程**。

### NFR-QA-003：向後相容性（Backward Compatibility）

002 的任何 schema 演進（KnowledgeEntry 新欄位）、Query Analysis 新流程，均不得破壞 001 已通過的 94 個單元測試。

新欄位採 nullable 或 default value；existing API response 結構不得 breaking change。

### NFR-QA-004：Rollout 安全性（Rollout Safety）

ranking profile 調整、query rule 變更，可能使現有 FAQ 查詢的命中率退步。必須：

1. 提供 golden fixture dataset（至少 20 筆常用 FAQ 問法）
2. 有 regression test suite 驗證 fixture 查詢的命中順序不退步
3. 新 ranking profile 在切換前可以 shadow compare 模式評估（不強制，但架構應支援）

### NFR-QA-005：Query Analysis 延遲預算（Latency Budget）

Query Analysis 完整流程（normalization + expansion + rule matching + profile selection）在 P90 不應超過 **20ms**。

rule-based 實作預期遠低於此上限；若引入外部 tokenizer，延遲需重新評估。

### NFR-QA-006：排名調整可控性（Ranking Tuning 可控性）

Ranking weight 的調整應有明確的操作程序：

1. 修改 SystemConfig（透過 admin API）
2. 執行 regression test suite
3. 確認 golden fixture 命中不退步
4. 若退步，可立即透過 SystemConfig 回滾，不需 code change

### NFR-QA-007：Template 回答一致性（Template Answer Consistency）

走 template 路徑的問題，回答內容來自 template 填空，不依賴 LLM 隨機生成。相同輸入應產生相同輸出（deterministic）。

**評估指標**：template 路徑的回答內容差異率 = 0%（除了填入的動態值外）。

---

## 6. In Scope / Out of Scope

### 6.1 002 In Scope

| 能力                           | 說明                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `QueryAnalysisModule`          | 可注入的 Query Analysis 模組，包含 IQueryAnalyzer 介面與預設 rule-based 實作                                  |
| `ITokenizer` 抽象              | 預設 rule-based tokenizer；保留 jieba / CKIP 插拔點                                                           |
| Query rules DB 治理            | stop words / noise words / question-shell patterns 存 DB，admin 可管理                                        |
| KnowledgeEntry schema 演進     | sourceKey / category / answerType / templateKey / faqQuestions / crossLanguageGroupKey / structuredAttributes |
| Seed 更新                      | 所有種子資料遵守新 schema，使用 sourceKey upsert                                                              |
| Admin Knowledge API 擴充       | 支援新欄位 CRUD                                                                                               |
| Ranking profile productsation  | 透過 SystemConfig 管理 ranking weights / profile                                                              |
| AdminSystemConfig 落地         | 不再是 NotImplementedException                                                                                |
| Feature flag / rollout support | 基礎 feature flag via SystemConfig                                                                            |
| `admin/intent/*` API           | IntentTemplate CRUD + cache invalidation                                                                      |
| `admin/glossary/*` API         | GlossaryTerm CRUD + cache invalidation                                                                        |
| IntentService 分層重構         | 三層 intent routing，使用 expandedTerms                                                                       |
| Template Resolver              | answerType 決定 template / rag / llm 路徑                                                                     |
| `DiagnosisService` 初版        | diagnosisContext 讀寫、狀態機介面、Phase 4 前置基礎                                                           |
| Regression benchmark dataset   | 至少 20 筆 golden FAQ fixtures                                                                                |
| AuditLog query analysis 欄位   | 記錄 matchedRules / selectedProfile / terms                                                                   |

### 6.2 002 Out of Scope

| 能力                                               | 說明                                                   |
| -------------------------------------------------- | ------------------------------------------------------ |
| 向量資料庫（pgvector / Pinecone 等）               | 002 不引入，架構保留 IRetrievalService 擴充點          |
| 完整語意搜尋平台替換                               | 不替換 pg_trgm 主方案                                  |
| Jieba / CKIP runtime 正式接入                      | ITokenizer 介面設計，但預設實作不依賴外部 NLP runtime  |
| Python 微服務 / 外部 NLP 平台作為硬依賴            | 002 保持單體 NestJS                                    |
| 推翻既有 SSE / sessionToken / Chat Pipeline 主流程 | 沿用 001 的 Chat Pipeline 基礎                         |
| Phase 4 問診完整實作                               | DiagnosisService 在 002 是初版基礎，Phase 4 才完整實作 |
| Auth / RBAC                                        | 繼承 001 的延後決定                                    |
| Dashboard / Lead / Ticket / Feedback API 修改      | 001 已完成，002 不動                                   |
| `isHighIntent()` 完整實作                          | 仍保留為 Phase 4（T4-005）任務                         |

---

## 7. 002 相對於 001 的差異摘要

### 7.1 沿用 001 不修改

- Chat Pipeline 主流程（SSE、sessionToken、RAG 主路徑）
- Safety / Blacklist / Prompt Guard 機制
- Conversation / AuditLog / Lead / Ticket / Feedback 資料模型主結構
- LLM Provider 抽象（ILlmProvider / OpenAiProvider）
- Widget Config API
- Dashboard API
- Health / AI Status 機制

### 7.2 002 升級的既有能力

| 模組                           | 001 狀態                            | 002 升級後                                                                                             |
| ------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `QueryNormalizer`              | 靜態 utility，hardcoded             | 重構為 `QueryAnalysisModule`，rules 來自 DB，可 admin 治理                                             |
| `IntentService.detect()`       | 只做 substring keyword match        | 三層分流（intentHints + expandedTerms + category fallback）                                            |
| `expandWithGlossary()`         | IntentService 內部 private method   | 提升為 Query Analysis 的正式 expansion pipeline                                                        |
| `KnowledgeEntry` schema        | title/content/tags/aliases/language | 新增 sourceKey/category/answerType/templateKey/faqQuestions/crossLanguageGroupKey/structuredAttributes |
| `RETRIEVAL_SCORING` 常數       | 靜態 TypeScript 常數                | 可透過 SystemConfig 管理的 ranking profile                                                             |
| `AdminSystemConfigService`     | NotImplementedException 骨架        | 正式落地 CRUD + cache invalidation                                                                     |
| Chat Pipeline（template 路徑） | 全走 RAG + LLM                      | 新增 template / rag+template 分流路徑                                                                  |

### 7.3 002 新增模組（非既有模組小修）

| 新模組                                 | 說明                                                   |
| -------------------------------------- | ------------------------------------------------------ |
| `QueryAnalysisModule`                  | 全新模組，包含 IQueryAnalyzer、預設實作、rule provider |
| `admin/intent/`                        | 全新 admin API（controller + service + DTO）           |
| `admin/glossary/`                      | 全新 admin API（controller + service + DTO）           |
| `AnswerTemplateResolver`               | 全新服務，決定 template / rag / llm 路徑               |
| `DiagnosisService` / `DiagnosisModule` | 全新模組，管理問診狀態機                               |

---

## 8. 成功指標（002 新增）

| 指標                             | 目標值                        | 量測方式                       |
| -------------------------------- | ----------------------------- | ------------------------------ |
| FAQ golden fixture 命中率        | ≥ 95% top-3 命中              | 20 筆 FAQ regression 測試      |
| Intent 識別準確率（新架構）      | ≥ 85%（對齊 spec.md §4 目標） | intent fixture 測試集（5+ 類） |
| Query Analysis P90 延遲          | ≤ 20ms                        | unit benchmark                 |
| Template 路徑 determinism        | 100%（相同輸入相同輸出）      | unit test                      |
| Admin cache invalidation         | ≤ 1 筆請求生效                | integration test               |
| 既有 001 測試                    | 全數通過（94 tests）          | CI                             |
| schema migration backward compat | 無 breaking change            | migration + existing seed test |
