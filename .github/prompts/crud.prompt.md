---
mode: agent
---

# 任務：生成 Nest.js 領域模組 CRUD

<!-- ## 核心設計模式
當我要求「生成 [ModelName] 的 CRUD，id 類型為 [Int/String]」時，請嚴格遵循 Nest.js 的架構規範： -->

## 1. 執行指令解析規則

當接收到指令時，請依序判斷以下參數：

- **模型名稱**: [ModelName]
- **主鍵型別**: 若註明 `id 類型為 Int/String`，請強制執行；若未註明，請參閱 `prisma/schema.prisma`。
- **自定義欄位**: 若指令包含 `欄位定義為 { name: type, ... }`，請優先以此定義生成 DTO，並同步更新 Prisma schema 建議。
- **軟刪除 (Soft Delete)**: 若指令包含 `加入 deleted_at`，請在 DTO 中加入該欄位，並在 Service 的刪除邏輯改為 `update` 操作而非 `delete`。

## 2. 資料庫模型與 Prisma 規範

- **欄位命名**: 嚴格遵循蛇穴命名法（snake_case）。
- **模型來源**: 所有的資料庫模型定義皆參考 `prisma/schema.prisma`。
- **欄位慣例**: 每個模型必須包含 `id` 欄位，且類型為 `Int` 或 `String`。此外，
  - 必須包含 `created_at` 與 `updated_at` (DateTime)。
- **嚴禁使用 Any**: 即使本地環境尚未執行 `prisma generate`，**禁止**生成 `(this.prisma as any).[modelName]`。
- **假設型別存在**: 請直接撰寫 `this.prisma.[modelName]`，假設 `PrismaClient` 已經根據 `schema.prisma` 更新。

## 3. 領域驅動目錄結構 (Domain-Driven Structure)

當新增一個模組（例如：`Products`）時，必須嚴格遵守以下結構：

- `src/[domain]/`
  - `dto/`: 存放該領域專用的 DTO（例如 `create-product.dto.ts`）。
  - `index.ts`: 負責匯出 DTO 供外部使用。
  - `[domain].controller.ts`: 處理 HTTP 請求。
  - `[domain].module.ts`: 模組定義。
  - `[domain].service.ts`: 業務邏輯與 Prisma 操作。

## 4. 共用資源整合 (Common Assets)

**嚴禁重複定義**，必須從 `src/common/` 引用：

- **DTO**: 列表查詢必須引用 `src/common/dto/pagination.dto.ts` 中的 `PaginationDto`；批次刪除引用 `delete.dto.ts`。
- **Interceptors**:
  - 所有 Controller 必須掛載 `@UseInterceptors(TransformInterceptor)` 以統一回應格式。
  - 列表統計與檔案處理分別掛載 `CountInterceptor` 或 `FileUrlInterceptor`。

## 5. 實作範本規範 (嚴格執行)

- **DTO 驗證**: 所有的 DTO 必須使用 `class-validator` 進行輸入驗證，確保資料完整性與安全性。
- **錯誤處理**: 使用 Nest.js 的 `HttpException` 類別來處理錯誤，並確保返回適當的 HTTP 狀態碼與錯誤訊息。
