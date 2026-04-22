/*
  Warnings:

  - A unique constraint covering the columns `[sourceKey,language]` on the table `knowledge_entries` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "intent_templates" ADD COLUMN     "category" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "knowledge_entries" ADD COLUMN     "answerType" TEXT NOT NULL DEFAULT 'rag',
ADD COLUMN     "category" TEXT,
ADD COLUMN     "crossLanguageGroupKey" TEXT,
ADD COLUMN     "faqQuestions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "sourceKey" TEXT,
ADD COLUMN     "structuredAttributes" JSONB,
ADD COLUMN     "templateKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_entries_sourceKey_language_key" ON "knowledge_entries"("sourceKey", "language");
