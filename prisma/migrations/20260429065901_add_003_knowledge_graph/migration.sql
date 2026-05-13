-- CreateEnum
CREATE TYPE "KnowledgeDocType" AS ENUM ('faq', 'product_spec', 'catalog', 'company_info', 'general');

-- CreateEnum
CREATE TYPE "KnowledgeEntityType" AS ENUM ('product', 'spec', 'category', 'company');

-- CreateEnum
CREATE TYPE "KnowledgeRelationType" AS ENUM ('is_variant_of', 'belongs_to_category', 'compatible_with', 'see_also');

-- CreateTable
CREATE TABLE "knowledge_documents" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "docType" "KnowledgeDocType" NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'zh-TW',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "metadata" JSONB,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "language" TEXT NOT NULL DEFAULT 'zh-TW',
    "metadata" JSONB,
    "embeddingId" TEXT,
    "sourceReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_entities" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entityType" "KnowledgeEntityType" NOT NULL,
    "canonicalKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_relations" (
    "id" TEXT NOT NULL,
    "fromEntityId" TEXT NOT NULL,
    "toEntityId" TEXT NOT NULL,
    "relationType" "KnowledgeRelationType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_relations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_documents_sourceKey_key" ON "knowledge_documents"("sourceKey");

-- CreateIndex
CREATE INDEX "knowledge_chunks_documentId_idx" ON "knowledge_chunks"("documentId");

-- CreateIndex
CREATE INDEX "knowledge_chunks_language_idx" ON "knowledge_chunks"("language");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_entities_canonicalKey_key" ON "knowledge_entities"("canonicalKey");

-- CreateIndex
CREATE INDEX "knowledge_relations_fromEntityId_idx" ON "knowledge_relations"("fromEntityId");

-- CreateIndex
CREATE INDEX "knowledge_relations_toEntityId_idx" ON "knowledge_relations"("toEntityId");

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "knowledge_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_relations" ADD CONSTRAINT "knowledge_relations_fromEntityId_fkey" FOREIGN KEY ("fromEntityId") REFERENCES "knowledge_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_relations" ADD CONSTRAINT "knowledge_relations_toEntityId_fkey" FOREIGN KEY ("toEntityId") REFERENCES "knowledge_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
