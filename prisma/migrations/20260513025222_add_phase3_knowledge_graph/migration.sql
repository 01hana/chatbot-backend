/*
  Warnings:

  - A unique constraint covering the columns `[sourceKey,language]` on the table `knowledge_documents` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "knowledge_documents_sourceKey_key";

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_documents_sourceKey_language_key" ON "knowledge_documents"("sourceKey", "language");
