# 震南官網 AI 客服聊天機器人 — Backend Spec

**版本**：1.7.0 | **建立日期**：2026-04-09 | **狀態**：Draft

---

## 1. 文件目的

本文件為「震南官網 AI 客服聊天機器人後端系統」的功能規格書（Spec），定義本期後端系統需要做什麼、為什麼做、以及驗收標準為何。

本文件的角色：
- 作為 `design.md`、`plan.md`、`task.md` 的上游依據
- 明確界定本期範圍與排除範圍
- 提供可量測的驗收條件，供測試與 QA 使用

> **本期實作總原則**：本期後端聊天主流程採 SSE / streaming 串接外部 LLM provider；本期預設 provider 為 OpenAI，provider 需可替換（未來可擴充 ClaudeProvider 等）；前端以 `sessionToken` 作為匿名訪客會話識別，後端內部映射至 `sessionId`。本期正式提供 Widget Config API。本期正式納入 Dashboard、Feedback API、Ticket。本期不做 Auth / Login / RBAC、Email 通知、handoff status API。

本文件**不定義**技術實作細節

---

### 10.5 Ticket（人工接手案件）

| 欄位 | 說明 | 必填 |
|------|------|------|
| `id` | 唯一識別碼 | ✓ |
| `lead_id` | 關聯 Lead（若由留資觸發）| — |
| `session_id` | 關聯會話 ID | ✓ |
| `status` | `open` / `in_progress` / `resolved` / `closed` | ✓ |
| `trigger_reason` | 觸發原因（`handoff` / `confidential_refuse` / `high_intent` 等）| ✓ |
| `summary` | 案件摘要（從 Lead 或 AI 生成）| ✓ |
| `assignee` | 負責人識別碼（本期無 Auth，可為空或預設值）| — |
| `notes` | 處理紀錄 / 備註（JSONB 陣列）| — |
| `deleted_at` | 軟刪除時間（null 表示未刪除）| — |
| `created_at` | 建立時間 | ✓ |
| `updated_at` | 最後更新時間 | ✓ |

### 10.6 Feedback（訪客回饋）

| 欄位 | 說明 | 必填 |
|------|------|------|
| `id` | 唯一識別碼 | ✓ |
| `session_id` | 關聯會話 ID | ✓ |
| `message_id` | 關聯 ConversationMessage ID | ✓ |
| `value` | `up` / `down` | ✓ |
| `reason` | 可選原因說明（自由文字或前端預定義選項）| — |
| `created_at` | 建立時間 | ✓ |

### 10.7 Widget Config（前端 Widget 配置）

> Widget Config API（`GET /api/v1/widget/config`）為前端 Widget 初始化的正式配置來源，提供歡迎訊息、快速回覆選項、服務狀態、免責聲明等。資料來源可為 `SystemConfig` 表或獨立設定表。

| 欄位 | 說明 |
|------|------|
| `status` | `online` / `offline` / `degraded`（Widget 對外服務狀態；AI 失效時自動回傳 `degraded`）|
| `welcomeMessage` | 歡迎訊息（多語系 JSONB：`{"zh-TW":"string","en":"string"}`）|
| `quickReplies` | 快速回覆選項（多語系 JSONB：`{"zh-TW":["string"],"en":["string"]}`）|
| `disclaimer` | 免責聲明文字（多語系 JSONB：`{"zh-TW":"string","en":"string"}`）|
| `fallbackMessage` | 離線 / AI 失效時的備用訊息（多語系 JSONB：`{"zh-TW":"string","en":"string"}`）|older、module、schema、interface），那些屬於 `design.md` 的範疇。

---

## 2. 專案背景與問題定義

### 2.1 背景

震南企業目前官網缺乏 24/7 即時客服能力。訪客對產品有問題時，只能透過 Email 或電話聯絡，導致：
- 非工作時段詢問無法即時回應，潛在商機流失
- 業務人員重複回答同類型產品規格問題，效率低落
- 詢價前置資訊收斂不足，造成業務跟進品質不均
- 無系統性留資機制，無法對高意向訪客主動推進

### 2.2 問題定義

本專案需解決以下核心問題：

1. **服務可用性缺口**：非工作時段無客服支援
2. **知識傳達效率低**：產品規格、FAQs 散落在官網各頁，訪客難以快速取得
3. **留資流程不系統化**：沒有結構化的 Lead 收集與交接機制
4. **機密洩露風險**：若引入 AI，必須防止機密技術資訊或內部資訊對外外洩
5. **回覆品質不可控**：AI 系統若無強制 RAG 規範，可能產生錯誤或幻覺回答

---

## 3. 專案目標

| # | 目標 | 優先級 |
|---|------|--------|
| G1 | 提供可對外部訪客使用的 AI 聊天後端 API，支援多輪對話 | P0 |
| G2 | 回覆須以核准公開知識為基礎，不得編造 | P0 |
| G3 | 機密保護：偵測並攔截涉及機密的問題，不得作答 | P0 |
| G4 | 建立完整留資閉環：留資收集 → 通知 → Lead 交接 → 人工接手 | P0 |
| G5 | 問診式產品推薦：收斂需求後才提供推薦，不跳過問診 | P1 |
| G6 | 系統可降級：AI 失效時留資與聯絡方式功能仍可運作 | P0 |
| G7 | 所有關鍵對話行為可追溯（稽核日誌） | P0 |
| G8 | 支援繁體中文與英文雙語對話 | P1 |
| G9 | 提供後台知識庫管理 API（知識上傳、審核、版本） | P1 |
| G10 | 提供對話紀錄與稽核資料查詢 API | P1 |

---

## 4. 成功指標（Success Metrics）

| 指標 | 目標值 | 量測方式 |
|------|--------|----------|
| FAQ / 公開資訊正確率 | ≥ 90% | 標準題庫測試（100 題） |
| 意圖識別準確率 | ≥ 85% | 標準意圖測試集 |
| 機密題庫攔截率 | 100% | 機密題庫全數攔截，不得有漏 |
| Prompt Injection 攔截率 | ≥ 95% | 10 種以上攻擊模式測試集 |
| 留資閉環成功率 | ≥ 95% | 留資後通知 / Lead 建立成功比例 |
| 回覆來源可追溯率 | 100% | 每筆對外回覆都有知識條目 ID + 版本 |
| 首次回覆時間（AI 正常） | ≤ 3 秒（P90） | P90 latency |
| 一般問答回覆時間（AI 正常） | ≤ 5 秒（P90） | P90 latency |
| Fallback 回覆時間（AI 失效） | ≤ 2 秒（P90） | P90 latency |
| 系統可用性 | ≥ 99.5% uptime | 監控統計 |
| 降級模式可用性 | 100% | AI 失效時留資 API 仍可收單 |
| 同時在線對話支援 | ≥ 50 組 | 壓力測試 |
| 中英雙語可用性 | 100% | 中英輸入均可正確回覆 |

---

## 5. 範圍界定（Scope）

### 5.1 In Scope（本期必做）

- 聊天 API 後端（建立會話、多輪對話、回覆生成）
- 聊天主流程採 **SSE / streaming** 回覆（逐 token 串流至前端）；前端以 `sessionToken` 識別會話，後端映射至內部 `sessionId`
- 意圖識別（含機密觸發、低信心追問）
- Strong RAG（知識庫檢索 + 信心閾值控管）
- Prompt Guard（Prompt Injection 偵測、越獄攔截、blacklist）
- 知識分級控管（public / internal / confidential）
- 問診式產品推薦後端邏輯
- 留資收集 API 與 Lead 建立
- **Ticket 實體**（轉介 / 人工接手案件追蹤）
- 通知後端（Webhook 推送、重試；Email 通知本期不做，列為後續擴充）
- 多語系後端支援（語言偵測、繁中 / 英文回覆）
- 稽核日誌（每輪對話完整記錄）
- 降級模式（AI 失效時的 fallback 機制）
- 知識庫後台 CRUD API（新增、更新版本、審核狀態管理）
- 對話紀錄查詢 API
- 詞彙表 / 意圖模板資料維護 API
- **Widget Config API**（`GET /api/v1/widget/config`，提供前端初始化配置）
- **Feedback API**（訪客對 AI 回覆的評分與回饋）
- **Dashboard API**（對話量、留資量、攔截量聚合資料）

### 5.2 Out of Scope（本期不做）

- 前端 UI、聊天視窗元件、畫面設計（任何形式）
- RBAC / 角色權限 / 使用者登入 / Auth 驗證機制
- 後台管理系統的前端介面
- Dashboard 前端介面（後端 Dashboard 聚合 API 本期提供，前端介面不做）
- 獨立向量資料庫產品或固定語意檢索實作（檢索策略由 `design.md` 決定）
- 多租戶架構
- **handoff status 查詢 API**（本期 handoff 語意為：觸發 Lead 與 / 或 Ticket 建立，回傳 `action=handoff`，不提供輪詢介面）
- **end session API**（訪客「重新開始對話」由前端清除 `sessionToken` 並重新建立 session 實現；後端不提供結束 session 的專用 endpoint）
- **Email 通知**（本期不做，架構保留 `IEmailProvider` 介面）

> 🔖 **本期相對於原始 SRS 的 Phase 化取捨**：
> - **納入本期**：SSE / streaming 主流程、sessionToken 會話識別、Widget Config API、Feedback API、Dashboard API、Ticket。
> - **延後**：Auth / RBAC / Login（本期採基礎設施層保護）、Email 通知（IEmailProvider 介面保留）、handoff status 輪詢 API、向量語意檢索、多租戶架構、自動封鎖敏感用戶。

> ⚠️ **本期運行前提**：後台知識維護 API、對話紀錄查詢 API、稽核查詢 API 本期不實作應用層 Auth / RBAC，但這些 API **不得視為可公開裸露對外的 API**。正式運行前，必須透過受控環境（內網、VPN、反向代理白名單或其他基礎設施保護）限制存取。此為本期部署前提，非未來擴充項目。

---

## 6. 使用者 / 系統角色

> 本期不實作 Auth / RBAC；角色僅作為需求描述用途，不代表本期需要驗證身份。
> 後台 API 存取需透過基礎設施層級保護（詳見 5.2 運行前提）。

| 角色 | 描述 | 本期互動方式 |
|------|------|-------------|
| 外部訪客 | 震南官網的不特定訪客 | 透過前端呼叫聊天 API（後端不限制身份） |
| 後台管理者 | 負責維護知識庫、審核知識條目、查看對話紀錄 | 透過後台 API（本期無應用層 Auth，需基礎設施保護） |
| 業務 / 客服人員 | 接收轉人工通知、處理 Lead | 透過 Webhook 接收（本期主要方式）；Email 通知本期不做 |
| 外部 LLM Provider | 外部 AI 生成服務（本期預設整合 OpenAI，provider 可替換）| 由後端統一呼叫，對外不可見；provider 需可替換 |
| Webhook 接收端 | 接收 Lead / 轉人工通知的外部系統 | 後端主動推送 |

---

## 7. 核心使用情境（User / System Scenarios）

### SC-01：訪客詢問產品規格

**主流程：**
訪客發送問題 → 後端以 `sessionToken` 識別匿名訪客會話（映射至內部 `sessionId`）→ 偵測語言 → 意圖識別 → 知識庫檢索（public 分級、approved 狀態）→ 信心分數判斷 → 達閾值則組裝 context 送外部 LLM → 透過 **SSE / streaming** 逐 token 串流回覆至前端 → 附上來源參考 → 寫入稽核日誌

**例外流程：**
- 信心分數低於閾值 → 返回「追問」回應，請訪客補充資訊
- 知識庫無命中 → 返回「無法確認，請留資或轉人工」
- 外部 LLM 服務失效 → 觸發 fallback，返回預設回覆 + 留資引導
- SSE 串流中斷 → 後端發送 `event: interrupted`，前端可顯示截斷提示

---

### SC-02：訪客詢問涉及機密資訊

**主流程：**
訪客發送問題 → Prompt Guard 掃描 → 意圖識別觸發 confidential 分級 → 返回拒答回覆 → 引導留資或轉人工 → 對話 `type` 標記為 `confidential`，`riskLevel` 標記為 `high` → 寫入稽核日誌（記錄攔截原因）

**關鍵限制：**
- 不得嘗試模糊作答或部分回答
- 不得在拒答訊息中洩露任何機密內容線索
- 本期不發送 Email 給管理者；confidential 命中結果以對話管理欄位（`type` / `riskLevel`）及稽核日誌為主要記錄方式

---

### SC-03：問診式產品推薦

**主流程：**
訪客詢問適合的型材 → 後端偵測為推薦意圖 → 後端依固定順序追問：①用途（purpose）→ ②材質（material）→ ③厚度（thickness）→ ④使用環境（environment）→ 收斂到足夠資訊後 → 比對規格知識庫 → 提供推薦清單 + 規格摘要 + 來源 → 偵測高意向 → 主動推動留資

**關鍵限制：**
- 不可在問診不足時直接推薦
- 規格比對規則優先；LLM 僅用於摘要與呈現，不可自由生成規格內容
- 本期問診欄位固定為四項，追問順序固定（purpose → material → thickness → environment）

---

### SC-04：Prompt Injection 攻擊攔截

**主流程：**
訪客發送含攻擊語句的訊息 → Prompt Guard 偵測（blacklist / pattern 比對）→ 攔截 → 返回標準拒答訊息 → 記錄稽核事件（攻擊模式、輸入 hash）→ 不觸發任何 LLM 呼叫

---

### SC-05：留資流程觸發

**觸發條件（任一）：**
- 訪客明確要求詢價或聯絡
- 問診完成後訪客表示有興趣
- 後端偵測到高意向行為（多輪詢問 + 詢價語句）
- 機密問題拒答後引導留資

**主流程：**
後端返回留資引導 → 前端呼叫留資 API 提交資料（`POST /api/v1/chat/sessions/:sessionToken/lead`，帶 `name`、`email`、`company?`、`phone?`、`message?`、`language?`）→ 後端建立 Lead 記錄 → 若為轉人工觸發，同時建立 Ticket → 推送 Webhook → 回傳 `{ action: 'handoff' }` 或同等語意 → 前端顯示「已轉交專人協助」→ 寫入稽核日誌

> 📌 **Email 通知本期不做**，列為後續可擴充項目。本期 Lead 通知以 Webhook 推送為主要閉環方式。

> 📌 **handoff status 查詢 API 本期不做**。前端收到後端回傳 `action=handoff` 即顯示已轉交訊息，不需輪詢 handoff status。

**例外流程：**
- Webhook 失敗 → 自動重試（重試次數與策略由 `design.md` 定義）→ 失敗記錄留存

---

### SC-06：AI 服務降級

**觸發條件：**
- 外部 LLM 服務呼叫超時
- 外部 LLM 服務返回錯誤（如 5xx 或 rate limit）
- 重試仍失敗（重試次數與策略由 `design.md` 定義）

**主流程：**
後端偵測 AI 失效 → 觸發 fallback → 返回預設回覆（告知服務暫時無法使用）+ 留資選項引導 → 記錄降級事件至稽核日誌 → 留資 API 仍正常接受提交

---

### SC-07：知識庫管理（後台）

後台管理者上傳新知識條目 → 設定 visibility 分級、意圖標籤、tags → 狀態預設為 `draft` → 審核通過後更新為 `approved` → 版本遞增 → 舊版本保留為 `archived` → 可供 RAG 檢索使用

---

## 8. 功能需求（Functional Requirements）

### 8.1 聊天主流程

| ID | 需求描述 | 優先級 |
|----|----------|--------|
| FR-001 | 系統可建立新的聊天會話，返回前端可用的唯一 `sessionToken`；後端內部以 `sessionId` 作為資料關聯主鍵 | P0 |
| FR-002 | 系統可接收訪客的文字訊息，前端帶 `sessionToken`，後端映射至對應 `sessionId` 並關聯 | P0 |
| FR-003 | 系統可在同一會話中保存多輪對話歷史，作為後續回覆的上下文 | P0 |
| FR-004 | 系統可對每條訊息產生回覆：正常流程為 Prompt Guard 通過 → 知識庫檢索（RAG）→ 信心分數達閾値 → 送外部 LLM provider（本期預設為 OpenAI）透過 **SSE / streaming** 逐 token 串流回覆；低信心時返回追問，LLM 失效時返回 fallback | P0 |
| FR-004a | SSE / streaming 回覆需支援以下狀態事件：`token`（token chunk）、`done`（完成）、`error`（後端錯誤）、`timeout`（超時）、`interrupted`（中斷）；前端以 `fetch + ReadableStream` 接收，可依事件類型決定顯示行為 | P0 |
| FR-004b | 後端需提供中止串流的控制機制（前端斷線時後端可感知並中止 LLM 呼叫，不繼續消耗 token）| P0 |
| FR-005 | 每次回覆需包含：回覆文字、引用知識來源（ID + 版本）、意圖標籤、信心分數 | P0 |
| FR-006 | 訊息過長時系統需截斷或拒絕處理，並返回標準錯誤回應 | P0 |
| FR-007 | 當系統無法產生有效回覆時，需返回明確的預設錯誤回應，不可靜默失敗 | P0 |
| FR-008 | 每個會話可記錄對話摘要（可用於轉人工交接）| P1 |

### 8.2 知識檢索與回覆生成

| ID | 需求描述 | 優先級 |
|----|----------|--------|
| FR-010 | 系統可依據訊息內容在知識庫中進行檢索，僅搜尋 `status=approved AND visibility=public` 的條目；具體檢索方案由 `design.md` 定義 | P0 |
| FR-011 | 系統可計算知識條目與訊息的相關性信心分數（0–1） | P0 |
| FR-012 | 當信心分數低於可配置閾值時，系統**不得**觸發 LLM 生成，應返回追問或拒答狀態；閾值需可透過設定調整，不可硬編碼 | P0 |
| FR-013 | 當信心分數達閾值時，系統可將相關知識條目組裝為 context，送往外部 LLM 生成回覆 | P0 |
| FR-014 | 生成回覆必須附上所引用知識條目的 ID 與版本號 | P0 |
| FR-015 | 若知識庫無任何相關命中（分數均低於最低可用閾值），系統應返回「無法確認，請留資」的引導回覆 | P0 |
| FR-016 | 外部 LLM 呼叫需設定超時與重試機制，不可無限等待；具體數值由 `design.md` 定義 | P0 |
| FR-017 | 外部 LLM 失效時必須觸發 fallback，返回預設回覆並記錄降級事件 | P0 |

### 8.3 問診式推薦

| ID | 需求描述 | 優先級 |
|----|----------|--------|
| FR-020 | 當偵測到產品推薦意圖時，系統需先進行問診，依固定順序收集四項資訊：①用途（purpose）→ ②材質（material）→ ③厚度（thickness）→ ④使用環境（environment） | P1 |
| FR-021 | 問診資訊不完整時，系統需主動追問，不可跳過問診直接推薦 | P1 |
| FR-022 | 問診資訊收斂後，系統依規格知識庫比對，提供推薦清單與規格摘要 | P1 |
| FR-023 | 規格比對規則優先；LLM 僅用於摘要與呈現，不可自由生成規格內容 | P1 |
| FR-024 | 問診完成後，系統需主動推動留資（返回留資引導）| P1 |
| FR-025 | 系統可偵測高意向行為（例如：多輪詢問、出現詢價語句），並在稽核日誌中記錄意向分數 | P1 |

### 8.4 意圖識別

| ID | 需求描述 | 優先級 |
|----|----------|--------|
| FR-030 | 系統可識別每條訊息的主要意圖，並記錄意圖標籤 | P0 |
| FR-031 | 意圖識別需支援同一意圖的多種問法（語意相似匹配） | P1 |
| FR-032 | 意圖識別結果需有信心分數，低信心結果需返回追問或選項澄清 | P1 |
| FR-033 | 系統支援後台維護意圖模板與同義詞資料，供意圖識別使用 | P1 |
| FR-034 | 特定意圖（詢價、轉人工請求）可直接觸發留資流程，無需通過 RAG | P0 |

### 8.5 多語系

| ID | 需求描述 | 優先級 |
|----|----------|--------|
| FR-040 | 系統可自動偵測輸入訊息的語言（至少支援繁體中文、英文）| P1 |
| FR-041 | 系統回覆語言需與訊息輸入語言一致 | P1 |
| FR-042 | 語言偵測結果需記錄至對話 context 與稽核日誌 | P1 |
| FR-043 | 系統支援後台維護多語系詞彙表，供意圖識別與回覆生成使用 | P1 |
| FR-044 | 機密防護與 Prompt Guard 需在任意語言輸入下均正常運作 | P0 |

### 8.6 機密保護與安全攔截

| ID | 需求描述 | 優先級 |
|----|----------|--------|
| FR-050 | 知識庫每筆條目需有 visibility 分級（public / internal / confidential），送入 LLM 的 context 只能包含 public 分級條目 | P0 |
| FR-051 | 系統可維護 Blacklist（禁止回答的問題清單），命中時必須拒答 | P0 |
| FR-052 | 當意圖或知識分級判斷觸及 confidential / internal 時，系統必須返回拒答訊號，不得嘗試部分回答；命中 confidential 時，對話的 `type` 應標記為 `confidential`，`riskLevel` 標記為 `high`；本期不發送 Email 給管理者 | P0 |
| FR-053 | 系統必須對所有訊息執行 Prompt Guard（後端顯式程式碼邏輯），偵測並攔截：試圖覆寫 system prompt、要求揭露 system prompt、越獄指令、blacklist 關鍵字 | P0 |
| FR-054 | 拒答回覆不可包含任何機密內容的線索或暗示 | P0 |
| FR-055 | Prompt Guard 攔截事件需完整記錄至稽核日誌（攻擊模式分類、輸入 hash）| P0 |
| FR-056 | 系統可追蹤對話中敏感意圖的累積次數；本期需記錄累積結果至稽核日誌，自動封鎖行為為未來擴充 | P2 |

### 8.7 留資與轉人工

| ID | 需求描述 | 優先級 |
|----|----------|--------|
| FR-060 | 系統提供留資提交 API（`POST /api/v1/chat/sessions/:sessionToken/lead`），接收前端 request body：`name`（必填）、`email`（必填）、`company?`（選填）、`phone?`（選填）、`message?`（訪客原始需求 / 留言，選填）、`language?`（前端語系，`zh-TW` / `en`，選填）；後端依 `sessionToken` 識別會話 | P0 |
| FR-061 | 留資成功後，系統需建立 Lead 記錄，狀態初始為 `new` | P0 |
| FR-062 | Lead 建立後需自動觸發 Webhook 推送（本期主要通知方式）；Email 通知本期不做，列為後續可擴充項目 | P0 |
| FR-063 | Webhook payload 需包含：`event`、`leadId`、`sessionId`、`customerName`、`email`、`company`、`phone`、`message`（訪客原始留言）、`summary`（AI 整理摘要）、`language`、`intent`、`triggerReason`、`type`、`confidentialityTriggered`、`promptInjectionDetected`、`sensitiveIntentCount`、`highIntentScore`、`transcriptRef`、`requestId`、`createdAt` | P0 |
| FR-064 | 留資資料需關聯對應的 sessionId 與對話摘要，作為人工接手的交接資訊 | P0 |
| FR-065 | Webhook 推送失敗時需自動重試；重試次數上限與退避策略由 `design.md` 定義 | P0 |
| FR-066 | 推送失敗需記錄失敗事件與失敗原因，不可靜默丟棄 | P0 |
| FR-067 | 系統可由後端判斷觸發轉人工（機密拒答後、高意向偵測後），亦可由訪客主動請求 | P0 |
| FR-068 | 轉人工時需自動產生對話摘要並附加至 Lead，作為人工接手交接資訊 | P1 |
| FR-069 | **handoff 觸發後，後端建立 Lead 與 / 或 Ticket，回傳 `action=handoff` 語意；本期不提供獨立 handoff status 查詢 API，前端依回傳語意直接顯示「已轉交專人協助」** | P0 |
| FR-070a | 系統提供 Ticket 建立 API，支援轉人工後案件的建立與狀態追蹤 | P0 |
| FR-070b | Ticket 狀態流轉：`open` → `in_progress` → `resolved` / `closed`；支援 Ticket 列表、詳情、狀態更新 API | P0 |
| FR-070c | Ticket 需關聯 Lead 與 sessionId，並可附加處理紀錄 / note | P1 |

### 8.8 知識庫與營運支援

| ID | 需求描述 | 優先級 |
|----|----------|--------|
| FR-070 | 系統提供知識條目新增 API（含 visibility、tags、意圖標籤設定）| P1 |
| FR-071 | 知識條目更新時需建立新版本（version + 1），舊版本保留為 `archived` | P1 |
| FR-072 | 系統提供審核狀態管理 API（draft → approved / archived）| P1 |
| FR-073 | 只有 `status=approved AND visibility=public` 的條目可被 RAG 檢索使用 | P0 |
| FR-074 | 系統提供對話紀錄查詢 API，可依 sessionId / 日期範圍 / 意圖標籤查詢 | P1 |
| FR-075 | 系統提供稽核日誌查詢 API，可依 requestId / 日期範圍 / 事件類型查詢 | P1 |
| FR-076 | 系統接收訪客對 AI 回覆的評分（讚 / 倒讚）與可選原因標記，並與訊息 / 對話關聯；後台可查詢與聚合 | P1 |
| FR-077 | 系統提供 Dashboard 聚合資料 API（`GET /api/v1/admin/dashboard`），至少包含：對話量、留資量、Ticket 量、常見意圖分布、轉人工原因分布、近期稽核事件摘要 | P1 |
| FR-078 | 系統提供 Widget Config API（`GET /api/v1/widget/config`），至少包含：`status`、`welcomeMessage`、`quickReplies`、`disclaimer`、`fallbackMessage`；為前端 Widget 初始化的正式配置來源 | P0 |

---

## 9. 非功能需求（Non-Functional Requirements）

### 9.1 安全

| ID | 需求描述 | 優先級 |
|----|----------|--------|
| NFR-001 | 甲方知識庫、對話資料與 Lead 資料必須存於甲方控制的資料庫，不得流入外部模型訓練 | **Must** |
| NFR-002 | internal 與 confidential 分級知識不得出現在任何對外回覆或 LLM context 中 | **Must** |
| NFR-003 | Prompt Guard 必須為後端顯式程式碼邏輯；不可把安全防護全部依賴 system prompt 文字 | **Must** |
| NFR-004 | 所有 API Key / 資料庫連線字串 / Webhook Secret 必須透過環境變數注入，不可硬編碼 | **Must** |
| NFR-005 | 對外 API 回傳的錯誤訊息不可洩露 stack trace 或內部路徑 | **Must** |
| NFR-006 | 所有外部輸入需通過嚴格的結構化驗證；不接受未知欄位，異常輸入需返回標準錯誤回應 | **Must** |
| NFR-007 | 聊天 API 需設定速率限制，具體數值需可透過設定調整，不可硬編碼 | **Must** |
| NFR-008 | 後台知識維護 API、對話紀錄查詢 API、稽核查詢 API 本期不實作應用層 Auth / RBAC，暫時採反向代理 + IP 白名單保護（適用於少數固定網路的內部測試與管理使用者）；此為暫時性的基礎設施保護方案，正式登入與權限控管於後續階段補上；本期不得直接暴露於公網 | **Must** |

### 9.2 品質（AI 回答品質）

| ID | 需求描述 | 優先級 |
|----|----------|--------|
| NFR-010 | 系統不得生成幻覺內容；所有回覆須基於 RAG 檢索結果 | **Must** |
| NFR-011 | RAG 信心閾值為硬性短路門檻；低於閾值不得觸發 LLM 生成 | **Must** |
| NFR-012 | 所有對外回覆必須可追溯至知識條目 ID 與版本號 | **Must** |
| NFR-013 | RAG 信心閾值需可透過設定動態調整，不可硬編碼；閾值變更需納入稽核（紀錄變更者、時間、前後值、影響範圍） | **Must** |
| NFR-014 | 系統不可在低信心時以「模糊語氣」生成推測性內容 | **Must** |

### 9.3 效能

| ID | 需求描述 | 目標值 | 優先級 |
|----|----------|--------|--------|
| NFR-020 | 首次回應時間（含 RAG + LLM，正常模式）| ≤ 3 秒（P90） | **Must** |
| NFR-021 | 一般問答回覆時間（正常模式）| ≤ 5 秒（P90） | **Must** |
| NFR-022 | Fallback 回應時間（AI 失效）| ≤ 2 秒（P90） | **Must** |
| NFR-023 | 留資 API 回應時間 | ≤ 1 秒（P90） | **Must** |
| NFR-024 | 一般列表查詢 API 回應時間 | ≤ 500ms（P90） | **Should** |
| NFR-025 | 同時在線對話支援 | ≥ 50 組 | **Must** |
| NFR-026 | 系統可用性 | ≥ 99.5% uptime | **Must** |
| NFR-027 | 連續 72 小時壓力測試無重大異常 | — | **Must** |

> 📌 MVP 階段可先以目標值管理上述指標，但正式驗收仍以本文件列出門檻為準。

### 9.4 可靠性

| ID | 需求描述 | 優先級 |
|----|----------|--------|
| NFR-030 | AI 服務失效時，系統必須可降級運作；留資 API 與聯絡引導功能不受影響 | **Must** |
| NFR-031 | 外部服務（LLM / Webhook）失敗時，系統不可拋出未處理錯誤；Email 通知本期不做，不納入此條 | **Must** |
| NFR-032 | 所有外部呼叫需設定超時與 retry；不可無限等待；具體數值由 `design.md` 定義 | **Must** |
| NFR-033 | Webhook 推送失敗需記錄，不可靜默丟棄；Email 通知本期不做，不納入此條 | **Must** |

### 9.5 可維護性

| ID | 需求描述 | 優先級 |
|----|----------|--------|
| NFR-040 | LLM provider 必須可替換，不鎖定任何單一供應商；業務邏輯不可直接耸合特定 LLM SDK；本期預設整合 OpenAI（實作 `OpenAiProvider`，業務層依賴 `ILlmProvider`），為系統核心回覆生成器；未來可擴充 `ClaudeProvider` | **Must** |
| NFR-041 | 知識檢索策略必須可替換；本期採用何種方案由 `design.md` 定義，但架構需支援未來升級 | **Must** |
| NFR-042 | 所有業務規則（機密判斷、意圖路由、留資觸發）需集中管理，不可散落各處 | **Must** |
| NFR-043 | 設計需允許從 MVP 漸進擴充，不可一開始就過度設計 | **Should** |
| NFR-044 | 系統需支援追蹤 LLM 呼叫的成本與使用量相關觀測資料：每次 LLM 呼叫的 `prompt_tokens`、`completion_tokens`、`total_tokens`、`duration_ms`、`model`、`provider` 必須記錄，支援成本追蹤、回覆品質問題追蹤、異常請求分析與模型切換比較 | **Must** |

### 9.6 資料治理

| ID | 需求描述 | 優先級 |
|----|----------|--------|
| NFR-050 | 對話資料、留資資料、稽核資料預設保存 **1 年**；超過 1 年可自動刪除；刪除採**軟刪除**（邏輯刪除，不立即物理移除）；若管理者已將該筆資料封存，則不可自動刪除 | **Must** |
| NFR-051 | 管理者可手動執行封存或刪除操作；封存後的資料不受自動刪除機制影響；實際保留期限與刪除政策需在部署前由甲方 / 法務 / 資安正式確認 | **Must** |
| NFR-052 | 與 Strong RAG 有關的關鍵閾值設定與變更，需納入稽核追蹤（紀錄變更者、時間、前後值、影響範圍）| **Must** |
| NFR-053 | 系統需支援分級規則與輸入觸發規則的**資料化管理**：知識內容分級由知識條目欄位（`visibility`）控制；輸入觸發規則（如 Prompt Guard 的 blacklist、pattern、SafetyRule）由資料庫管理，後台 API 可維護；不可在程式碼中硬編碼完整規則清單 | **Must** |

---

## 10. 資料需求（Data Requirements）

> 本節定義最低資料欄位需求。詳細 schema 設計（資料模型、索引、關聯）於 `design.md` 定義。

### 10.1 知識條目（KnowledgeEntry）

| 欄位 | 說明 | 必填 |
|------|------|------|
| id | 唯一識別碼 | ✓ |
| title | 條目標題 | ✓ |
| content | 條目正文 | ✓ |
| intent_label | 關聯意圖標籤（可多值）| ✓ |
| visibility | `public` / `internal` / `confidential` | ✓ |
| status | `draft` / `approved` / `archived` | ✓ |
| version | 版本號（整數遞增）| ✓ |
| source_id | 來源參考 ID（若有）| — |
| tags | 標籤陣列 | — |
| owner | 建立 / 負責人識別碼 | — |
| approved_at | 審核通過時間 | — |
| created_at | 建立時間 | ✓ |
| updated_at | 最後更新時間 | ✓ |

### 10.2 對話訊息（ConversationMessage）

| 欄位 | 說明 | 必填 |
|------|------|------|
| id | 唯一識別碼 | ✓ |
| session_id | 所屬會話 ID | ✓ |
| turn_id | 對話輪次序號 | ✓ |
| role | `user` / `assistant` / `system` | ✓ |
| message | 訊息內容（已脫敏）| ✓ |
| detected_language | 偵測語言 | ✓ |
| detected_intent | 意圖標籤 | ✓ |
| intent_confidence | 意圖信心分數 | ✓ |
| rag_confidence | RAG 信心分數 | ✓ |
| source_references | 引用知識條目 `[{id, version}]` | ✓ |
| prompt_guard_result | `pass` / `blocked` | ✓ |
| prompt_injection_detected | 是否偵測到攻擊 | ✓ |
| confidentiality_triggered | 是否觸發機密攔截 | ✓ |
| action_taken | 動作類型（`reply` / `ask_clarification` / `refuse` / `handoff` / `fallback`）| ✓ |
| type | 對話分類（`public` / `internal` / `confidential` / `handoff`）；命中 confidential 時設為 `confidential` | ✓ |
| risk_level | 風險等級（`low` / `medium` / `high`）；命中 confidential 時設為 `high` | ✓ |
| fallback_triggered | 是否觸發降級 | ✓ |
| created_at | 建立時間 | ✓ |

### 10.3 Lead（留資記錄）

> 本期 Lead 為潛在客戶 / 留資紀錄實體。Ticket 為轉介 / 人工接手案件實體（見 §10.5）。兩者有清楚分工：Lead 代表訪客留資意願，Ticket 代表人工接手的後續案件追蹤。
>
> **API request contract 與內部資料模型的對應**：前端提交留資時以 `name` 欄位傳送訪客姓名；後端儲存時映射至 `customer_name`。前端可帶 `message`（訪客原始留言）；後端另行生成 `summary`（AI 整理摘要）。

| 欄位 | 說明 | 必填 |
|------|------|------|
| `lead_id` | 唯一識別碼 | ✓ |
| `session_id` | 關聯會話 ID | ✓ |
| `customer_name` | 訪客姓名（對應前端 `name` 欄位）| ✓ |
| `company` | 公司名稱 | — |
| `email` | Email | ✓ |
| `phone` | 電話 | — |
| `message` | 訪客原始需求 / 留言（對應前端 `message` 欄位）| — |
| `summary` | 需求摘要（AI 自動生成；若 `message` 有值則輔助生成，若無則由對話內容生成）| — |
| `language` | 訪客語系（`zh-TW` / `en`；由前端帶入或後端偵測）| — |
| `intent` | 觸發留資的意圖標籤 | ✓ |
| `confidentiality_triggered` | 是否因機密拒答觸發 | ✓ |
| `trigger_reason` | 留資觸發原因（`user_request` / `high_intent` / `confidential_refuse` / `handoff`）| ✓ |
| `prompt_injection_detected` | 對話中是否偵測到攻擊 | ✓ |
| `injection_reason` | 攻擊摘要（若有）| — |
| `transcript_ref` | 對話紀錄參考 ID（sessionId）| ✓ |
| `request_id` | 觸發留資當輪的全鏈路追蹤 ID | ✓ |
| `status` | `new` / `in_progress` / `closed` | ✓ |
| `notification_status` | Webhook 推送狀態（本期；Email 通知為未來擴充）| ✓ |
| `deleted_at` | 軟刪除時間（null 表示未刪除）| — |
| `archived_at` | 封存時間（null 表示未封存）| — |
| `created_at` | 建立時間 | ✓ |

### 10.4 稽核日誌（AuditLog）

稽核日誌為 append-only，最低欄位需求：

| 欄位 | 說明 |
|------|------|
| request_id | 全鏈路追蹤 ID（UUID v4）|
| timestamp | 事件時間（ISO 8601）|
| session_id | 關聯會話 |
| actor | `anonymous` 或未來的 userId |
| endpoint | 觸發的 API endpoint |
| intent | 偵測意圖 |
| rag_confidence | RAG 信心分數 |
| prompt_guard_result | `pass` / `blocked` |
| blocked_reason | 攔截原因（若有）|
| knowledge_refs | 引用知識條目 `[{id, version}]` |
| ai_provider | 使用的 AI 供應商（如 `openai`、未來可擴充 `claude` 等）|
| ai_model | 模型名稱 |
| ai_model_version | 模型版本 |
| prompt_tokens | 本次 LLM 呼叫的 prompt token 數（未呼叫 LLM 時為 0）|
| completion_tokens | 本次 LLM 回覆的 token 數（未呼叫 LLM 時為 0）|
| total_tokens | `prompt_tokens + completion_tokens` |
| prompt_hash | 送出 prompt 的 SHA256 hash |
| response_hash | 接收回覆的 SHA256 hash |
| fallback_triggered | 是否降級 |
| lead_triggered | 是否觸發留資 |
| human_handoff_triggered | 是否轉人工 |
| duration_ms | 處理時間（ms）|
| config_snapshot | 本次關鍵閾值設定快照（如 RAG 閾值），供事後追溯 |
| archived_at | 封存時間（null 表示未封存；封存後不受自動刪除影響）|

---

## 11. 對外整合需求（Integration Requirements）

### 11.1 聊天 API（後端提供）

後端需提供以下 API 能力，供前端或第三方呼叫：

| API 能力 | 說明 | 優先級 |
|----------|------|--------|
| 建立會話 | 建立新 session，返回前端可用的 `sessionToken`；後端內部以 `sessionId` 作為資料關聯主鍵 | P0 |
| 發送訊息（SSE 串流）| 接收訊息（帶 `sessionToken`），透過 SSE 逐 token 串流回覆；支援 `event: token` / `event: done` / `event: error` / `event: timeout` / `event: interrupted` 狀態事件；前端以 fetch + ReadableStream 接收 | P0 |
| 取得對話歷史 | `GET /api/v1/chat/sessions/:sessionToken/history`；依 `sessionToken` 取得該會話的完整對話記錄 | P1 |
| 提交留資 | `POST /api/v1/chat/sessions/:sessionToken/lead`；request body：`name`（必填）、`email`（必填）、`company?`、`phone?`、`message?`（訪客原始留言）、`language?`（`zh-TW` / `en`，由前端帶入當前語系）；後端建立 Lead 並觸發 Webhook | P0 |
| 觸發轉人工 | `POST /api/v1/chat/sessions/:sessionToken/handoff`；由前端明確觸發轉人工；後端建立 Lead（`trigger_reason=handoff`）+ Ticket；回傳 `{accepted, action, leadId?, ticketId?, message}` | P0 |
| Widget Config | `GET /api/v1/widget/config`；返回前端 Widget 初始化所需的配置（歡迎訊息、快速回覆、服務狀態、免責聲明、備用訊息），均為多語系結構 | P0 |
| 提交回饋 | `POST /api/v1/chat/sessions/:sessionToken/messages/:messageId/feedback`；接收訪客對某輪回覆的 `value: "up" | "down"` 評分與可選 `reason`；與訊息 / 對話關聯 | P1 |
| 取得降級狀態（內部 health）| 後端 internal health / monitoring endpoint，供維運監控使用；**非前端正式初始化 contract**。前端 Widget 初始化以 `GET /api/v1/widget/config` 的 `status` 欄位（`online` / `offline` / `degraded`）為唯一狀態依據 | P2 |
| Ticket API | 建立 Ticket、查詢 Ticket 列表 / 詳情、更新狀態、附加處理紀錄 | P0 |
| Dashboard API | `GET /api/v1/admin/dashboard`；返回對話量、留資量、Ticket 量、意圖分布等聚合資料 | P1 |

### 11.2 外部 LLM Provider

- 後端透過統一的 `ILlmProvider` 介面呼叫外部生成服務；本期預設 實作為 `OpenAiProvider`（OpenAI Chat Completions API），未來可擴充 `ClaudeProvider`
- 本期建議模型策略：
  - 主力 / demo：`gpt-5.4-mini`
  - 高品質測試：`gpt-5.4`
  - 廉價快速 / fallback：`gpt-5.4-nano`
  - 模型可透過 `LLM_MODEL` 環境變數切換，不可硬編碼在業務邏輯中
- 需具備超時、retry、雙層 fallback 能力：
  - 第一層：主模型失敗→ 改用較便宜、較快的模型（`gpt-5.4-nano`）
  - 第二層：次級模型仍失敗→ 顯示固定 fallback 訊息：「目前 AI 忙磁中，請留下聯絡資訊／聯絡業務」
  - fallback 為正式產品流程，非臨時補丁；fallback 事件必須寫入 AuditLog（`fallbackTriggered=true`）
- 需確認所選 provider 的資料使用政策符合甲方要求，不得將甲方資料用於外部訓練
- Provider / model / version 需由環境變數設定，便於替換

### 11.3 Email 通知（本期不做，列為後續擴充）

> 📌 **本期不實作 Email 通知**。Email 通知（通知業務 / 客服 Lead 建立）列為後續可擴充項目，架構上保留 `IEmailProvider` 介面擴充點。

本期 Lead 通知閉環以 Webhook 推送（§11.4）為主，對話管理欄位（`type` / `riskLevel`）作為輔助標記。

### 11.4 Webhook 推送

- Lead 建立後觸發 Webhook POST 至指定 endpoint
- Webhook URL / Secret 由環境變數設定
- **HMAC 簽名**：本期**不強制要求**；若甲方接收端系統需要驗證，可啟用（後端架構已預留支援）；是否啟用需甲方接收端確認，列為後續擴充項目
- 失敗需重試並記錄失敗事件；重試次數上限與退避策略由 `design.md` 定義

**本期 Webhook payload 最小規格（Lead 建立時）：**

| 欄位 | 說明 |
|------|------|
| `event` | 事件類型，固定為 `lead.created` |
| `leadId` | Lead 唯一識別碼 |
| `sessionId` | 關聯會話 ID |
| `customerName` | 訪客姓名（對應 Lead.customer_name）|
| `email` | Email |
| `company` | 公司名稱（選填，可為 null）|
| `phone` | 電話（選填，可為 null）|
| `message` | 訪客原始需求 / 留言（選填，可為 null）|
| `summary` | AI 整理摘要（選填，可為 null）|
| `language` | 訪客語系（`zh-TW` / `en`；可為 null）|
| `intent` | 觸發留資的意圖標籤 |
| `triggerReason` | 留資觸發原因 |
| `type` | 對話分類（`public` / `confidential` / `handoff` 等）|
| `confidentialityTriggered` | 是否因機密拒答觸發（boolean）|
| `promptInjectionDetected` | 是否偵測到攻擊行為（boolean）|
| `sensitiveIntentCount` | 對話中累積敏感意圖次數 |
| `highIntentScore` | 對話累積高意向分數 |
| `transcriptRef` | 對話紀錄參考 ID（sessionId）|
| `requestId` | 觸發留資當輪的全鏈路追蹤 ID |
| `createdAt` | Lead 建立時間（ISO 8601）|

### 11.5 推送失敗紀錄

- Webhook 的每次推送嘗試需記錄：嘗試時間、HTTP 狀態碼、失敗原因、重試次數
- 最終失敗（超過重試上限）需標記並可供後台查詢

---

## 12. 驗收條件（Acceptance Criteria）

| ID | 驗收條件 | 量測方式 |
|----|----------|----------|
| AC-001 | FAQ / 公開資訊問答正確率 ≥ 90% | 以 100 題標準題庫測試，人工評分 |
| AC-002 | 意圖識別準確率 ≥ 85% | 以標準意圖測試集（至少 50 題）測試 |
| AC-003 | 機密題庫（confidential）攔截率 = 100% | 以 50 題機密題庫測試，不得有任何一題洩漏 |
| AC-004 | Prompt Injection 題庫攔截率 ≥ 95% | 以 10 種以上攻擊模式（共 ≥ 30 題）測試 |
| AC-005 | 留資提交成功後 Lead 建立率 = 100% | 自動化整合測試 |
| AC-006 | Lead 建立後 Webhook 通知成功率 ≥ 99%（含 retry）；Email 通知本期不做，不列入驗收 | 自動化整合測試 |
| AC-007 | 所有對外回覆均附有知識條目 ID + 版本引用 | 自動化測試：查詢稽核日誌，`knowledge_refs` 不可為空 |
| AC-008 | 中英文雙語輸入均可正常回覆，語言偵測正確率 ≥ 95% | 以 50 題中 / 英各半的測試集測試 |
| AC-009 | 首次回應時間 ≤ 3 秒（P90，正常模式）| 壓測 50 concurrent sessions，測 P90 latency |
| AC-010 | 一般問答回覆時間 ≤ 5 秒（P90，正常模式）| 壓測 50 concurrent sessions，測 P90 latency |
| AC-011 | Fallback 模式回應時間 ≤ 2 秒（P90）| 模擬 AI 失效，測 P90 latency |
| AC-012 | AI 失效時留資 API 仍可正常接收提交 | 模擬 AI 服務失效，驗證留資流程不中斷 |
| AC-013 | 低信心分數時（< 閾值）不觸發 LLM 生成 | 單元測試：確認短路邏輯正確 |
| AC-014 | 稽核日誌每筆記錄均含 requestId 與 timestamp | 自動化測試：查詢稽核日誌，逐筆驗證 |
| AC-015 | 拒答回覆不包含任何機密內容線索 | 人工審查機密題庫的拒答回覆 |
| AC-016 | 系統可用性 ≥ 99.5% uptime | 監控統計，正式驗收週期內量測 |
| AC-017 | 連續 72 小時壓力測試無重大異常（服務中斷、未處理錯誤、資料遺失）| 壓力測試報告 |
| AC-018 | 高意向測試集（多輪詢問 + 詢價語句）可正確觸發主動留資引導 | 自動化整合測試：驗證留資引導回覆被正確返回 |
| AC-019 | 多輪敏感套話測試中，敏感意圖累積達門檻時可正確觸發轉人工引導；本期需至少記錄累積結果，自動封鎖為未來擴充 | 整合測試：驗證稽核日誌記錄累積次數，且觸發轉人工引導 |

---

## 13. 風險與待釐清事項

### 13.1 已知風險

| 風險 | 影響 | 因應方向 |
|------|------|----------|
| R-001：外部 LLM 服務 latency 不穩定 | 回應時間超標，服務體驗差 | 設定超時 + fallback；前端需自行處理等待體驗 |
| R-002：知識庫內容品質不足 | RAG 命中率低，大量追問或拒答 | 先確保核心 FAQ 與產品規格入庫並審核通過 |
| R-003：Prompt Injection 未知攻擊模式 | 攔截率未達標 | 建立可動態更新的 blacklist + pattern list |
| R-004：PII 資料未妥善脫敏 | 隱私合規風險 | 對話訊息落地前執行 PII redaction |
| R-005：RAG 閾值設定不當 | 閾值過高 → 大量拒答；閾值過低 → 低信心內容仍生成 | 以測試集驗證閾值，並確保閾值可動態調整並納入稽核 |

### 13.2 待釐清事項

| # | 問題 | 影響範圍 | 需確認對象 |
|---|------|----------|-----------|
| Q-001 | 震南產品的機密資訊清單與分級標準為何？`confidential` / `internal` / `public` 三層各自的實際關鍵字由誰提供？| 知識分級設定、機密題庫建立 | 甲方 |
| Q-002 | Webhook 接收端為哪個系統（CRM / 自建）？payload 欄位是否已對齊本期規格（FR-063）？| FR-063、FR-064 | 甲方 |
| Q-003 | 對話資料、留資資料、稽核資料的保存期限（預設 1 年）與刪除 / 封存政策是否符合甲方 / 法務 / 資安要求？| NFR-050、NFR-051 | 甲方 / 法務 / 資安 |
| Q-004 | 本期問診模板固定為四欄位（purpose / material / thickness / environment），追問順序已拍板；問診需涵蓋哪些產品線，由甲方確認 | FR-020 實作範圍 | 甲方 |
| Q-005 | 對話摘要是由 LLM 自動生成，還是固定模板？（建議：LLM 生成，失敗時 template fallback）| FR-008、FR-068 | 技術判斷 |
| Q-006 | 後台 API 的反向代理 + IP 白名單保護由誰設定與維護？正式運行前需確認 | NFR-008、部署架構 | 甲方 / 運維 |
| Q-007 | `pg_trgm` 擴充在目標部署環境是否可啟用？若不可用，需確認 fallback 檢索策略是否滿足 MVP 驗收條件 | FR-010、NFR-041 | 甲方 / 運維 |

---

## 14. 未來擴充（Future Considerations）

> 以下項目**不列入本期交付範圍**，記錄於此供後續規劃參考。

| 項目 | 說明 |
|------|------|
| Auth / 登入 / RBAC | 後台管理者登入驗證、角色權限控管，本期採反向代理 + IP 白名單暫時保護，正式登入與權限控管於後續階段補上 |
| Email 通知 | Lead 建立後通知業務 / 客服人員；本期不做，架構保留 `IEmailProvider` 介面擴充點 |
| handoff status 查詢 API | 本期 handoff 語意為回傳 `action=handoff`，前端直接顯示已轉交；輪詢 / 推播式 handoff status API 列為後續擴充 |
| 語意向量檢索升級 | 以向量化語意搜尋方案替換或補強現有檢索策略，提升語意搜尋精準度；具體方案留待 `design.md` 評估 |
| 多租戶架構 | 若未來需支援多個客戶或品牌，可擴充為多租戶模式 |
| 敏感意圖累積自動封鎖 | 本期僅記錄累積結果；自動封鎖邏輯為未來擴充 |
| 內部員工應用場景 | 若未來需支援內部員工查詢（internal / confidential 分級開放），需獨立設計流程與 Auth |
| 主動式訊息推送 | 由後台主動向訪客 session 推送特定訊息（需前端配合）|
| LLM Fine-tuning | 在合規前提下，以標注對話資料微調自有模型 |
| 自動化報表匯出 | 對話量 / 留資量 / 攔截量資料匯出 CSV / Excel |

---

## 修訂記錄

| 版本  | 日期       | 修訂摘要 |
|-------|------------|----------|
| 1.0.0 | 2026-04-09 | 初版建立，涵蓋 14 章節，對齊 constitution v1.1.0 |
| 1.1.0 | 2026-04-09 | 二次修訂：收斂 spec/design 邊界、統一 Lead 實體、補強後台 API 運行前提、調整效能指標（P90）、新增資料治理 NFR、補強 AC-018/019、移除硬編碼技術數值 |
| 1.3.0 | 2026-04-10 | 最後一輪精修：①FR-004 明確回覆主流程（Prompt Guard → RAG → 信心閾值 → LLM）；②新增 NFR-044 LLM 呼叫成本與可觀測性需求；③NFR-040 補強 OpenAI 為本期核心回覆生成器說明；④§10.4 AuditLog 補入 prompt_tokens / completion_tokens / total_tokens 欄位；⑤§11.4 Webhook HMAC 明確改為「本期不強制，後續擴充」語氣；⑥NFR-031/033 移除 Email 語氣改為 Webhook only；⑦§11.5 推送失敗紀錄移除 Email；⑧§6 業務客服角色說明更新為 Webhook 為主 |
| 1.4.0 | 2026-04-12 | 同步修訂（對齊前端規格）：①聊天主流程正式採 SSE / streaming（FR-004/004a/004b），移除 streaming 為 deferred 的說明；②建立會話改回傳 `sessionToken`，前端以 sessionToken 識別，後端映射至 sessionId（FR-001/002）；③新增 Widget Config API（FR-078、§10.7、§11.1）；④正式納入 Ticket（FR-070a/b/c、§10.5）、Feedback（FR-076 改為 P1、§10.6）、Dashboard（FR-077 改為 P1）；⑤handoff 語意修正為建立 Lead + Ticket + 回傳 action=handoff，不提供 handoff status 輪詢 API（FR-069）；⑥§5.2 Out of Scope 更新，加入 Phase 化取捨說明；⑦§14 移除 Streaming 為未來擴充，改為 handoff status API 與 Email 為延後項目 |
| 1.5.0 | 2026-04-13 | 最後一輪 API contract 對齊修訂：①§10.6 Feedback：`rating: thumbs_up/thumbs_down` → `value: up/down`，移除 `comment` 欄位；②§10.7 Widget Config：`status` 改為 `online/offline/degraded`，welcomeMessage/quickReplies/disclaimer/fallbackMessage 改為多語系 JSONB 結構；③§11.1 API 能力表：更新 SSE 事件格式說明（event: token/done/error/timeout/interrupted），新增獨立 handoff API 能力（`POST .../handoff`），新增 history API（`GET .../history`），明確 feedback API 路徑與 `value: up/down` 欄位，說明前端以 fetch + ReadableStream 接收 |
| 1.6.0 | 2026-04-13 | API contract 一致性修訂（對齊前端 spec）：①FR-004a SSE 事件 `data` → `token`，明確前端以 fetch + ReadableStream 接收；②FR-060 補入 Lead API request contract（name/email 必填，company/phone/message/language 選填）；③FR-063 Webhook payload 補入 `message`、`language` 欄位；④§10.3 Lead 資料模型新增 `message`、`language`、`summary` 欄位說明，明確 API contract 與內部模型對應關係；⑤§11.1 提交留資 API 說明補入完整 request body；⑥§11.1 「取得降級狀態」改為 internal health/monitoring endpoint，非前端正式 init contract；⑦§11.4 Webhook payload 補入 `message`、`language`、區分 `summary` 欄位；⑧§5.2 Out of Scope 新增 end session API；⑨Q-005 改為已定案（本期不做 end session API）；⑩§5.2 Out of Scope「報表 Dashboard 前端」改為「Dashboard 前端介面」，消除 Reports scope 歧義；⑪SC-05 補入留資 API request contract 說明 |
| 1.7.0 | 2026-04-16 | LLM provider 抽象化修訂（承接 design.md v1.9.0）：①本期實作總原則更新為 provider-agnostic + 預設 OpenAI；②角色表「外部 LLM Provider」加入可替換說明；③FR-004 送外部 LLM 語言改為 provider-neutral；④NFR-040 補強 `ILlmProvider` 抽象 + `ClaudeProvider` 未來擴充；⑤§11.2 全面改寫：`ILlmProvider`、本期模型策略（gpt-5.4-mini/gpt-5.4/gpt-5.4-nano）、雙層 fallback 策略 |

**版本**：1.7.0 | **建立日期**：2026-04-09 | **狀態**：Draft
