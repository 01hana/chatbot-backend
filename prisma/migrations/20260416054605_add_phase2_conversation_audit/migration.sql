-- CreateTable
CREATE TABLE "conversations" (
    "id" SERIAL NOT NULL,
    "sessionId" TEXT NOT NULL,
    "session_token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "type" TEXT NOT NULL DEFAULT 'normal',
    "riskLevel" TEXT,
    "sensitiveIntentCount" INTEGER NOT NULL DEFAULT 0,
    "highIntentScore" INTEGER NOT NULL DEFAULT 0,
    "diagnosisContext" JSONB,
    "language" TEXT NOT NULL DEFAULT 'zh-TW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_messages" (
    "id" SERIAL NOT NULL,
    "conversationId" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'normal',
    "riskLevel" TEXT,
    "blockedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "requestId" TEXT,
    "sessionId" TEXT,
    "eventType" TEXT NOT NULL,
    "eventData" JSONB,
    "knowledgeRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ragConfidence" DOUBLE PRECISION,
    "blockedReason" TEXT,
    "promptHash" TEXT,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "aiModel" TEXT,
    "aiProvider" TEXT,
    "configSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversations_sessionId_key" ON "conversations"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_session_token_key" ON "conversations"("session_token");

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
