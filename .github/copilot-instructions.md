# GitHub Copilot: Nest.js 專案規範

## 目錄

1. [技術棧與架構](#技術棧與架構)
2. [程式碼編寫規範](#程式碼編寫規範)
3. [實作準則](#實作準則)
4. [資料庫與安全性](#資料庫與安全性)
5. [禁止行為](#禁止行為)

## 技術棧與架構

- **模組化設計**: 遵循 Domain-Driven Design (DDD) 或功能模組化（Feature-based modules）。每個 Module 必須包含 `controller`, `service`, `module` 檔案。
- **分層架構**: 嚴格遵循 Module-Controller-Service 三層架構。
  - `Controllers`: 只負責請求驗證與路由回應，不寫商業邏輯。
  - `Services`: 處理商業邏輯與資料庫互動。
  - `DTOs`: 定義輸入驗證規則（使用 `class-validator`）。
- **資料庫**: Prisma ORM / TypeORM。
- **驗證**: `class-validator` 與 `class-transformer`。

## 程式碼編寫規範

- **依賴注入**: 務必使用建構函式注入（Constructor Injection），禁止使用 `new` 實例化 Service。
- **裝飾器使用**:
  - Controller 必須標註 `@Controller('path')`。
  - API 方法必須標註 `@Get()`, `@Post()`, `@Patch()`, `@Delete()`。
  - 參數獲取優先使用 `@Body()`, `@Query()`, `@Param()`, `@Headers()`。
- **DTO 設計**: 所有 Request Body 必須建立 `*.dto.ts` 類別，並標註驗證裝飾器（如 `@IsString()`, `@IsNotEmpty()`）。
- **錯誤處理**: 使用 Nest.js 的 `HttpException` 類別來處理錯誤，並確保返回適當的 HTTP 狀態碼。
- **命名規範**:
  - 類別名稱使用 PascalCase（如 `UserService`）。
  - 變數和函式名稱使用 camelCase（如 `getUserById`）。
  - 參數名稱應明確表達其意圖、內容與用途，避免使用單個字母 (如 i, j) 或混淆的縮寫。
- **測試**: 每個 Service 和 Controller 必須有對應的單元測試，使用 Jest 框架進行測試編寫。
- **文件註解**: 使用 JSDoc 風格的註解來說明類別、方法和參數的用途，確保代碼可讀性和維護性。

## 實作準則

- **例外處理**:
  - 使用內建的 `HttpException` 或其子類（如 `NotFoundException`）。
  - 全局錯誤處理應由 `Exception Filter` 統一攔截。
- **攔截器**: 所有的 API 回傳格式應通過 `Interceptor` 進行統一封裝（如 `{ data: T, code: number }`）。
- **安全性**: 敏感邏輯必須配合 `@UseGuards(JwtAuthGuard)`。

## 資料庫與安全性

- **資料庫連線**: 使用環境變數管理資料庫連線資訊，確保敏感資訊不被硬編碼。
- **SQL 注入防護**: 使用 ORM 提供的查詢構建器或參數化查詢來防止 SQL 注入攻擊。
- **敏感資料加密**: 對於敏感資料（如密碼）必須使用適當的加密方法（如 bcrypt）進行加密存儲。
- **跨站請求偽造（CSRF）防護**: 在需要的情況下，使用 CSRF Token 來保護 API 免受 CSRF 攻擊。
- **跨站腳本攻擊（XSS）防護**: 對輸入進行適當的過濾和轉義，防止 XSS 攻擊。
- **安全標頭**: 使用適當的 HTTP 安全標頭（如 Content-Security-Policy, X-Content-Type-Options）來增強應用的安全性。

## 禁止行為

- **禁止使用 `any` 類型**: 所有變數和函式參數必須明確定義類型，禁止使用 `any`。
- **禁止直接操作資料庫**: 所有資料庫操作必須通過 Service 層進行，禁止在 Controller 中直接操作資料庫。
- **禁止硬編碼**: 所有配置和敏感資訊必須通過環境變數管理，禁止在代碼中硬編碼。
- **禁止使用全局變數**: 所有變數應該在函式或類別內部定義，禁止使用全局變數。
- **禁止使用同步方法**: 所有 I/O 操作（如資料庫查詢、文件讀寫）必須使用異步方法，禁止使用同步方法。
