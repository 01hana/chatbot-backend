# 功能規格書：混合式檢索與無答案閘門

**功能分支**：`003-hybrid-retrieval-no-answer-gate`  
**建立日期**：2026-04-29  
**狀態**：草稿  
**前置功能**：002-query-analysis-foundation  

---

## 背景

001 建立了 AI 客服後端 SSE 主流程。002 新增了 QueryAnalysisModule、AnswerTemplateResolver、DiagnosisService，以及 KnowledgeEntry 結構化欄位。

實際前台測試後，發現三個結構性問題仍待解決：

1. **查詢理解邏輯屬於錯誤的層級。** 分詞、弱詞判斷、bigram 啟發式規則、domain signal 偵測等語言理解職責不應由 PostgresRetrievalService 承擔；該服務應作為純粹的關鍵字檢索器，接受已清理的搜尋詞清單執行 DB 查詢。

2. **無答案閘門缺失。** 只要檢索結果分數超過 `rag_minimum_score`，管線即呼叫 OpenAI——即使命中的條目與使用者問題只有間接關聯。

3. **zh-TW 分詞品質不足。** 目前以規則為基礎的 bigram 方法，在不依賴硬編碼 domain 知識的情況下，無法有效區分產品詞彙與問句殼層詞彙。

003 將建立正確的產品級架構，全面解決上述三個問題。

### Graph-ready / Graph-assisted 定位

003 V1 的圖譜檢索定位為 **Graph-ready / Graph-assisted retrieval foundation**，明確區別於完整 Microsoft-style GraphRAG：

- **不要求**：從大量文件自動抽取完整知識圖譜
- **不要求**：community detection 或 community summary
- **不要求**：Neo4j 或專用圖資料庫
- **不要求**：多跳權重傳播的完整 graph traversal

`KnowledgeEntity` / `KnowledgeRelation` / `GraphRetriever` 在 003 中作為輕量圖譜輔助檢索基礎。GraphRetriever V1 可以是 interface + stub，或 simple Postgres join 實作；完整 GraphRAG 能力可作為後續 004+ 或獨立 feature 演進。

003 核心目標仍是：**中英文 Query Understanding（Jieba 優先）→ Hybrid Retrieval → No-answer Gate → Traceable Answer**。Graph-assisted retrieval 提供實體擴展支援，不構成獨立的 blocking deliverable。

---

## 使用者情境與測試 *(必填)*

### 使用者故事 1 — 中文產品查詢正確命中知識條目（優先級：P1）

zh-TW 使用者詢問產品類別。系統使用正式分詞器解析問句，識別產品詞彙，擷取相關知識條目，並回傳有依據的答案。

**為何此優先級**：這是客服機器人的核心功能。若 zh-TW 分詞不準確、檢索不可靠，系統便無法服務主要使用情境。

**獨立測試方式**：透過 `feature.query_understanding_v2_enabled=true` 及 `feature.zh_tokenizer=jieba`，向聊天端點送出 `你們有哪些螺絲類別？`。驗證回覆內容來自螺絲類別知識條目，且 AuditLog 顯示 `canAnswer=true`、`answerMode` 為 `llm` / `rag+template` / `template` / `hybrid_rag` 其中之一，以及非空的 `sourceReferences`。若 `answerMode=llm` 或 `hybrid_rag`，則同時驗證 `llmCalled=true`；若 `answerMode=template` 或 `rag+template`，則 `llmCalled=false` 亦屬正確行為。

**驗收情境**：

1. **假設** zh-TW 使用者查詢包含產品詞（例如「螺絲」），**當** 系統以 Jieba 分詞模式處理時，**則** 產品詞應被提取為高權重 token，且相關知識條目的回傳分數應超過答案閾值。

2. **假設** 相同查詢在 Jieba 停用時（使用規則式 fallback），**當** 系統處理時，**則** 系統仍應回傳可用結果（降級服務），雖然品質可能略低。

3. **假設** 查詢包含規格識別碼（304、316、M3、M4），**當** 進行分詞時，**則** 這些識別碼應保留為獨立的高權重 token，並作為檢索候選詞使用。

---

### 使用者故事 2 — 不支援的問句不呼叫 OpenAI（優先級：P1）

使用者提出目前知識庫尚無對應內容的問題（例如：知識庫尚未涵蓋 `business_hours` / `company_address` 資料時的營業時間詢問、一般問候、明顯 out-of-scope 查詢）。系統將查詢分類為 `unsupported` 或評估 `canAnswer=false`，跳過 LLM 呼叫，直接回傳 fallback 訊息。若未來知識庫新增 `business_hours` / `company_info` 類資料，相同類型的查詢應可透過 `RetrievalDecision.canAnswer=true` 正常回答；`unsupported` 應由「當前知識庫是否有對應內容及強 token」動態決定，不以固定問題類型永久封鎖任何 queryType。

**為何此優先級**：直接防止 API 費用浪費，以及 LLM 從無關知識庫內容生成誤導性答案。與 P1 並列，因為兩者共同定義了控制 LLM 存取的閘門。

**獨立測試方式**：透過 `feature.no_answer_gate_enabled=true`，送出 `你們上班營業時間什麼時候？`。驗證 AuditLog 顯示 `canAnswer=false`、`llmCalled=false`、`action=fallback`，且 SSE `token` 事件中不含 LLM 輸出。

**驗收情境**：

1. **假設** 查詢的所有 token 均為 `noise` 或 `unknown` 類型（問句殼層詞彙 / 非領域詞彙），且知識庫無對應內容，**當** Query Understanding 將其分類為 `unsupported` 時，**則** 管線應回傳 fallback 訊息，不呼叫 OpenAI。

2. **假設** 檢索有回傳結果，但所有結果的分數均低於 `rag_minimum_score`，**當** 無答案閘門評估 `canAnswer` 時，**則** `canAnswer=false`，管線跳過 LLM。

3. **假設** `feature.no_answer_gate_enabled=false`（舊版模式），**當** 相同的不支援查詢進入時，**則** 應保留既有行為（向下相容的 fallback 路徑不變）。

---

### 使用者故事 3 — 英文產品查詢回傳有依據的答案（優先級：P2）

英語使用者詢問產品、報價或型錄下載。系統正確解析英文查詢、移除停用詞、識別領域相關詞彙，並擷取適當的知識條目。

**為何此優先級**：英文查詢是次要但重要的受眾。架構調整不得使現有英文檢索品質退化。

**獨立測試方式**：向聊天端點送出 `What screw categories do you offer?` 及 `How can I contact your company for a quote?`。兩者均應從知識庫回傳條目（或針對 quote/contact 意圖回傳聯絡 fallback），且不應因過度過濾而無聲地回傳空結果。

**驗收情境**：

1. **假設** 英文查詢包含產品詞（screw、bolt、wire），**當** EnglishTokenizer 處理時，**則** 停用詞應被移除，產品詞保留為搜尋候選詞。

2. **假設** 英文查詢帶有聯絡或報價意圖，**當** 分類時，**則** `QueryTypeClassifier` 應輸出 `quote_request` 或 `contact`，管線路由至對應的答案模式。

3. **假設** `feature.zh_tokenizer=jieba` 已啟用，**當** 英文查詢進入時，**則** 系統應使用 EnglishTokenizer（非 Jieba），英文檢索不受影響。

---

### 使用者故事 4 — 生成的答案包含可回溯的來源引用（優先級：P2）

系統以擷取的知識回答使用者問題時，回應中包含結構化的 metadata，標明使用了哪些知識條目，以便稽核與驗證。

**為何此優先級**：B2B 情境中建立信任的必要條件。營運人員必須能夠驗證客服機器人的答案來自授權的知識內容。

**獨立測試方式**：送出一個能匹配知識條目的產品查詢。在 AuditLog 中驗證 `selectedChunks`、`sourceReferences`（包含條目 ID 及 sourceKey），以及 `answerMode` 為 `llm` / `rag+template` / `template` / `hybrid_rag` 其中之一均存在。若 `answerMode=llm` 或 `hybrid_rag`，則同時驗證 `llmCalled=true`。

**驗收情境**：

1. **假設** LLM 生成了答案，**當** 管線完成時，**則** `GeneratedAnswer` 應帶有非空的 `sourceReferences` 清單，其中至少包含一個條目 ID 與 sourceKey。

2. **假設** 答案為直接套用範本（非 LLM 生成），**當** 記錄至 AuditLog 時，**則** `answerMode=template`，且 `sourceReferences` 指向匹配的範本條目。

3. **假設** `feature.traceable_answer_enabled=false`，**當** 答案生成時，**則** `sourceReferences` 欄位仍保留於 `GeneratedAnswer` 合約中；`feature.traceable_answer_enabled` 只控制額外的 trace 及 chunk-level metadata 是否填充，不影響 `sourceReferences` 的存在。

---

### 使用者故事 5 — Jieba 初始化失敗不崩潰管線（優先級：P3）

若 Jieba 函式庫初始化失敗（缺少執行檔、字典檔損毀），系統應 fallback 至 RuleBasedTokenizer，以降級但可運作的分詞方式繼續服務。

**為何此優先級**：運行可靠性。分詞器失敗絕對不能導致聊天端點停擺。

**獨立測試方式**：模擬 Jieba 初始化失敗（mock 或指向損毀的字典路徑）。送出任意查詢。驗證系統有回應（透過 RuleBasedTokenizer fallback）、WARN 日誌已輸出，且未回傳 500 錯誤。

**驗收情境**：

1. **假設** Jieba 初始化失敗，**當** 查詢進入時，**則** `TokenizerProvider` 應輸出 WARN 日誌並回傳 `RuleBasedTokenizer` 實例。

2. **假設** Jieba 於請求執行中拋出例外，**當** 進行分詞時，**則** 例外應被捕獲，改用 fallback 分詞器，聊天管線繼續執行。

---

### 邊界情況

- 若 `expandedTerms` 同時包含 `product` / `spec` / `material` 等強 token 與 `noise` / `unknown` 類弱 token，應如何處理？`QueryUnderstandingService V2` 應只將強 token 輸出至 `retrievalPlan`；`KeywordRetriever` 接受的候選詞清單中不應包含 `noise` / `unknown` token。
- 若 Jieba 對有效的中文查詢產生零個 token，應如何處理？系統應 fallback 至正規化後的查詢字串作為單一候選詞。
- 系統如何處理中英夾雜的查詢（code-mix）？每個語言片段應由對應的分詞器處理。
- 若所有檢索策略均未回傳結果，但 Query Understanding 將查詢分類為 `supported`，應如何處理？`canAnswer` 仍必須為 `false`（無 context = 無答案）。
- 若查詢屬於 `business_hours` / `company_address` 類，但知識庫目前無對應條目，應如何處理？`SupportabilityClassifier` 應輸出 `unsupported`，`canAnswer=false`，回傳 fallback 訊息；若知識庫後續新增對應資料，相同查詢應可正常命中（`canAnswer=true`）。
- 若 `feature.hybrid_retrieval_enabled=false` 且 `feature.no_answer_gate_enabled=true`，應如何處理？閘門仍必須以純關鍵字檢索結果正確運作。

---

## 需求規格 *(必填)*

### 功能需求

#### 步驟一 — Query Understanding V2

- **FR-001**：系統必須提供 `TokenizerProvider` 抽象層，依據偵測到的語言及 `feature.zh_tokenizer` feature flag 選取對應的分詞器。

- **FR-002**：`JiebaTokenizer` 必須將 zh-TW 文字切分為有意義的 token，並保留數字規格識別碼（304、316、M3、M4）為不可分割的 token。

- **FR-003**：`JiebaTokenizer` 必須支援載入包含產品專屬詞彙的 domain 字典（螺絲、螺栓、螺帽、華司、線材、不鏽鋼等）。

- **FR-004**：若 `JiebaTokenizer` 初始化失敗或分詞過程中拋出例外，`TokenizerProvider` 必須 fallback 至 `RuleBasedTokenizer` 並輸出 WARN 日誌。聊天管線不得拋出 500 錯誤。

- **FR-005**：`EnglishTokenizer` 必須對英文查詢執行小寫轉換、標點符號移除、停用詞過濾，並回傳含義詞 token。

- **FR-006**：`QueryUnderstandingService` V2 必須產出 `QueryToken[]` 清單，每個 token 帶有：`text`、`tokenType`（product / spec / material / dimension / action / business / contact / noise / unknown）、`weight`（0.0–1.0）、`source`（jieba / rule-based / english）。tokenType 值域定義：`product`（產品名稱，如螺絲、螺栓、螺帽）、`spec`（規格識別碼，如 304、316、M3、M4）、`material`（材質，如不鏽鋼、碳鋼）、`dimension`（尺寸描述，如 10mm、直徑）、`action`（動詞意圖，如查詢、了解、需要）、`business`（商務詞彙，如報價、型錄、下載）、`contact`（聯絡詞彙，如電話、Email、聯絡我們）、`noise`（問句殼層 / 停用詞，如你們、我想知道、上班時間、請問）、`unknown`（無法分類）。

- **FR-007**：`QueryTypeClassifier` 必須將查詢分類為下列其中之一：`product_lookup`、`product_comparison`、`quote_request`、`contact`、`catalog_download`、`business_hours`、`general_faq`、`unsupported`、`unknown`。分類邏輯不得內嵌於 PostgresRetrievalService。

- **FR-008**：`SupportabilityClassifier` 必須依據查詢類型及強 token 的有無，輸出 `supported`、`unsupported` 或 `unknown`。判斷原則：（a）所有 token 均為 `noise` 或 `unknown` 類型時，必須分類為 `unsupported`；（b）QueryType 指向知識庫中可能有對應內容的類別（如 `business_hours`、`company_info`）時，若知識庫確實包含對應 document / entry，應分類為 `supported`，否則分類為 `unsupported`；（c）`unsupported` 的判斷必須動態反映當前知識庫狀態，不得以固定的 queryType 永久封鎖任何類別的查詢。

- **FR-009**：Query Understanding V2 必須以 `feature.query_understanding_v2_enabled` feature flag 控制。停用時，系統 fallback 至現有的 QueryAnalysisService（002）。

#### 步驟二 — 知識圖譜模型

- **FR-010**：系統必須定義 `KnowledgeDocument` 實體，用於將相關知識條目歸屬至單一來源文件（手動 FAQ、產品型錄、公司資訊等），欄位包含：`id`、`sourceKey`、`title`、`docType`（faq / product_spec / catalog / company_info / general）、`language`、`status`、`createdAt`、`updatedAt`。

- **FR-011**：系統必須定義 `KnowledgeChunk` 實體，表示 KnowledgeDocument 的可檢索片段，欄位包含：`id`、`documentId`、`content`、`chunkIndex`、`tokenCount`、`language`、`embeddingId`（V1 可為 nullable）、`sourceReference`。

- **FR-012**：系統必須定義 `KnowledgeEntity` 與 `KnowledgeRelation` 資料表，以支援檢索時的圖譜擴展。初版實作可使用 Postgres 儲存（不需要外部圖資料庫）。`KnowledgeEntity`：`id`、`name`、`entityType`（product / spec / category / company）、`canonicalKey`。`KnowledgeRelation`：`id`、`fromEntityId`、`toEntityId`、`relationType`（is_variant_of / belongs_to_category / compatible_with / see_also）。

- **FR-013**：不得對現有 `KnowledgeEntry` 進行破壞性 migration。003 必須以加法性 migration 新增 `KnowledgeDocument`、`KnowledgeChunk`、`KnowledgeEntity`、`KnowledgeRelation` 四張資料表。現有 `KnowledgeEntry` 資料列不得刪除或搬移；如有需要，可透過 backfill 腳本建立對應的 document / chunk 記錄。既有 Admin API 對 `KnowledgeEntry` 的讀寫行為維持不變。

#### 步驟三 — 混合式檢索

- **FR-014**：系統必須提供 `HybridRetrievalService`，負責協調多個檢索策略並回傳合併、排序後的候選清單。

- **FR-015**：`KeywordRetriever` 必須實作現有 PostgresRetrievalService 的 pg_trgm / ILIKE 邏輯。它必須接受已由 Query Understanding 過濾的乾淨搜尋詞清單，且不得包含任何語言分析或弱詞過濾邏輯。

- **FR-016**：`VectorRetriever` 介面必須定義並提供 stub 實作。初版實作可回傳 `[]`。介面必須可透過依賴注入替換，以便未來導入 pgvector 實作時不需修改呼叫方。

- **FR-017**：`GraphRetriever` 必須定義介面（interface），規範輸入（查詢實體集合）與輸出（擴展後的 `KnowledgeChunk` 候選清單）合約。初版實作可為 stub（回傳 `[]`）或利用 `KnowledgeRelation` Postgres join 的最小可用版本；完整 graph retrieval（多跳擴展、權重傳播）可延後至後續版本實作。

- **FR-018**：`RetrievalFusionService` 必須合併多個 retriever 的結果，依 chunk/entry ID 去重（保留最高分），並透過 `RerankerService` 產出最終排序清單。

- **FR-019**：`HybridRetrievalService` 必須以 `feature.hybrid_retrieval_enabled` feature flag 控制。停用時，系統使用現有的 `PostgresRetrievalService` 路徑。V1 實作中，若 `VectorRetriever` 或 `GraphRetriever` 為 stub（回傳 `[]`），`HybridRetrievalService` 必須明確允許以 `KeywordRetriever` 作為主要可用 retriever；無答案閘門（No-answer Gate）的 `canAnswer` 判斷不得依賴尚未完成的 vector 或 graph 結果。

- **FR-020**：`RetrievalDecision` 必須帶有：`canAnswer`（boolean）、`reason`（string）、`confidence`（0–1 數值）、`topK`（RetrievalResult[]）。

- **FR-021**：以下任一條件成立時，`canAnswer` 必須為 `false`：（a）未回傳任何 chunk；（b）最高 chunk 分數低於 `rag_minimum_score`；（c）Query Understanding 將查詢分類為 `unsupported`。

#### 步驟四 — 無答案閘門與可回溯答案

- **FR-022**：當 `feature.no_answer_gate_enabled=true` 且 `canAnswer=false` 時，管線必須回傳標準 fallback 訊息，且不得呼叫 LLM。AuditLog 必須記錄 `action=fallback`、`llmCalled=false`、`canAnswer=false` 與 `reason`。

- **FR-023**：當 `feature.no_answer_gate_enabled=true` 且 `canAnswer=true` 時，管線必須僅以 `RetrievalFusionService` 選定的 chunk 呼叫 LLM。

- **FR-024**：`GeneratedAnswer` 必須始終包含：`message`（string）、`sourceReferences`（`{ entryId, sourceKey, chunkIndex, score }` 清單）、`answerMode`（llm / rag+template / template / hybrid_rag / fallback）、`confidence`（數值）。`answerMode` 值域定義：`llm`（純 LLM 生成，`llmCalled=true`）、`rag+template`（002 AnswerTemplateResolver 結合 RAG 上下文，`llmCalled=false`）、`template`（直接命中 002 範本，`llmCalled=false`）、`hybrid_rag`（混合式 retrieval + LLM，`llmCalled=true`）、`fallback`（無答案閘門觸發或無可用內容，`llmCalled=false`）。當 `feature.traceable_answer_enabled=true` 時，另須包含 `trace`（各管線步驟耗時物件）及 chunk-level metadata；`feature.traceable_answer_enabled` 不影響 `sourceReferences` 的存在與否。

- **FR-025**：當 Query Understanding V2 啟用時，AuditLog 必須記錄：`queryUnderstanding`（tokens、分類、supportability）、`retrievalPlan`（使用的策略、各策略候選數量）、`retrievalCandidates`（top-K 及分數）、`relevanceDecision`（canAnswer、reason、confidence）、`llmCalled`（boolean）。

- **FR-026**：架構邊界約束：`KeywordRetriever` 及 `PostgresRetrievalService` 不得承擔任何 Query Understanding 職責，包括分詞、弱詞判斷、bigram 產生、domain signal 偵測及 supportability 判斷；上述職責必須由 `QueryUnderstandingService V2` / `TokenizerProvider` / classifier 層負責。不得在 retrieval 層重新加入 hardcoded 中文弱詞、bigram 或 domain signal 規則。002 舊路徑（QueryAnalysisService fallback）在 003 rollout 初期可保留作為 feature flag fallback；待 Query Understanding V2 + No-answer Gate + Hybrid Retrieval 的 regression suite 全數通過、`feature.query_understanding_v2_enabled` 準備成為 default 時，再執行舊路徑 cleanup，確保 rollback 能力。此 FR 不構成「第一批任務即刪除既有 fallback path」的授權。

#### Feature Flags

- **FR-027**：以下 feature flags 必須可從 `SystemConfig`（key/value）讀取：

  | Flag | 型別 | 預設值 | 效果 |
  |------|------|--------|------|
  | `feature.query_understanding_v2_enabled` | boolean | false | 啟用 QU V2 管線 |
  | `feature.zh_tokenizer` | enum: `rule-based` \| `jieba` | `rule-based` | 選取 zh-TW 分詞器 |
  | `feature.hybrid_retrieval_enabled` | boolean | false | 啟用 HybridRetrievalService |
  | `feature.no_answer_gate_enabled` | boolean | false | 在 LLM 前強制執行 canAnswer 閘門 |
  | `feature.traceable_answer_enabled` | boolean | false | 啟用額外的 trace 及 chunk-level metadata |

### 關鍵實體

- **QueryToken**：表示從使用者查詢中提取的單一 token。  
  欄位：`text`、`tokenType`（product / spec / material / dimension / action / business / contact / noise / unknown）、`weight`（0–1）、`source`（jieba / rule-based / english）。

- **QueryUnderstandingResult**：QueryUnderstandingService V2 的輸出物件。  
  欄位：`rawQuery`（原始查詢字串）、`normalizedQuery`（正規化後）、`language`（偵測語言）、`tokenizer`（使用的分詞器：jieba / rule-based / english）、`tokens`（QueryToken[]）、`keyPhrases`（高權重 token 文字清單）、`intentCandidates`（意圖候選，string[]）、`queryType`（QueryTypeClassifier 輸出）、`supportability`（supported / unsupported / unknown）、`unsupportedReason`（string，選填）、`retrievalPlan`（建議的檢索策略清單）、`debugMeta`（object，選填，含各步驟耗時）。

- **KnowledgeDocument**：知識內容的頂層分組單位。  
  欄位：`id`、`sourceKey`、`title`、`docType`、`language`、`status`。

- **KnowledgeChunk**：可檢索的知識單元。  
  欄位：`id`、`documentId`、`content`、`chunkIndex`、`tokenCount`、`language`、`embeddingId`（nullable）、`sourceReference`。

- **KnowledgeEntity**：從知識中提取的命名實體。  
  欄位：`id`、`name`、`entityType`、`canonicalKey`。

- **KnowledgeRelation**：實體之間的具型關聯。  
  欄位：`id`、`fromEntityId`、`toEntityId`、`relationType`。

- **RetrievalDecision**：檢索融合後產出的決策物件。  
  欄位：`canAnswer`（boolean）、`reason`（string）、`confidence`（數值）、`topK`（RetrievalResult[]）。

- **GeneratedAnswer**：回傳給客戶端的最終答案封包。  
  欄位：`message`（string）、`sourceReferences`（`{ entryId, sourceKey, chunkIndex, score }` 清單，始終包含）、`answerMode`（llm / rag+template / template / hybrid_rag / fallback）、`confidence`（數值）、`trace`（物件，選填，僅 `feature.traceable_answer_enabled=true` 時填充）。

---

## 成功標準 *(必填)*

### 可量化成果

- **SC-001**：當 `feature.no_answer_gate_enabled=true` 時，知識庫領域外的查詢（營業時間、一般問候、不相關主題）100% 回傳 `llmCalled=false`。

- **SC-002**：啟用 `feature.query_understanding_v2_enabled=true` 及 `feature.zh_tokenizer=jieba` 後，regression baseline 中所有 20 條 zh-TW 黃金 FAQ fixture 仍產出 `expectedAction=answer` 或 `expectedAction=template`。

- **SC-003**：英文檢索零退化：啟用 `feature.query_understanding_v2_enabled` 後，regression baseline 中所有 10 條英文 FAQ fixture 的回傳分數仍 ≥ `rag_minimum_score`。

- **SC-004**：模擬 Jieba 初始化失敗，在 current baseline test suite 中產生零個 500 錯誤及零個測試失敗。

- **SC-005**：`KeywordRetriever` 及 `PostgresRetrievalService` 不包含語言理解、分詞、停用詞／弱詞判斷、bigram 產生、domain signal 或 supportability 判斷；上述職責由 `QueryUnderstandingService V2` / `TokenizerProvider` / classifier 處理。驗收重點為「retrieval 層不承擔 query understanding 職責」，不依賴特定變數名稱是否存在作為驗收依據。

- **SC-006**：`feature.traceable_answer_enabled=true` 時，每一筆 LLM 生成答案的 AuditLog 項目均包含非空的 `sourceReferences` 清單。

- **SC-007**：所有 feature flag 保持預設值（false）的情況下，003 功能程式碼合併後，current baseline test suite 不需修改即全數通過。

---

## 假設前提

- Jieba 將以 npm 套件形式導入（`nodejieba` 或具備 TypeScript binding 的同等套件）。具體套件待定，但必須支援自訂字典載入，且與 Node.js ≥ 18 相容。**風險提示**：`nodejieba` 等套件涉及 native addon，必須於 CI 環境及部署環境驗證能否正常編譯；若初始化失敗，`TokenizerProvider` 必須 fallback 至 `RuleBasedTokenizer`（見 FR-004），不得讓聊天管線回傳 500 錯誤。

- Domain 字典內容（產品詞彙）將從現有的 `KnowledgeEntry.tags`、`KnowledgeEntry.sourceKey` 及 `GlossaryTerm` 記錄中擷取。獨立的字典管理 UI 不在 003 範圍內。

- `VectorRetriever` 實作（pgvector embedding 生成）不在 003 範圍內。介面與 stub 在範圍內；實際向量搜尋可在 004 接續。

- `KnowledgeDocument` / `KnowledgeChunk` schema migration 為加法性新增；003 期間不 migrate 或刪除現有 `KnowledgeEntry` 資料列。

- 圖譜檢索（FR-017）在模型與介面定義範圍內；初版實作可為 stub（回傳 `[]`）或 Postgres join 最小可用版本，完整 graph retrieval 可延後實作。不需要專用的圖資料庫。

- `feature.query_understanding_v2_enabled` 在生產環境預設為 `false`，直到 RG-001 至 RG-003 完整 regression suite 在新管線下全數通過為止。

- SSE 聊天端點合約（`POST /api/v1/chat/sessions/:sessionToken/messages`）及其面向客戶端的 payload 結構維持不變。新欄位（`sourceReferences`、`trace`）為加法性新增，向下相容。

- 001 ChatPipeline SSE 主流程、002 AnswerTemplateResolver、002 DiagnosisService，以及所有現有 Admin API 均維持可正常運作，不需修改。
