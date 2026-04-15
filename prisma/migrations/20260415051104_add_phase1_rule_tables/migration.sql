-- CreateTable
CREATE TABLE "safety_rules" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "isRegex" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "safety_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blacklist_entries" (
    "id" SERIAL NOT NULL,
    "keyword" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blacklist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intent_templates" (
    "id" SERIAL NOT NULL,
    "intent" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "keywords" TEXT[],
    "templateZh" TEXT NOT NULL,
    "templateEn" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intent_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "glossary_terms" (
    "id" SERIAL NOT NULL,
    "term" TEXT NOT NULL,
    "synonyms" TEXT[],
    "intentLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "glossary_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_entries" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "intentLabel" TEXT,
    "tags" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'draft',
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "knowledge_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_versions" (
    "id" SERIAL NOT NULL,
    "knowledgeEntryId" INTEGER NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "contentSnapshot" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "blacklist_entries_keyword_key" ON "blacklist_entries"("keyword");

-- CreateIndex
CREATE UNIQUE INDEX "intent_templates_intent_key" ON "intent_templates"("intent");

-- CreateIndex
CREATE UNIQUE INDEX "glossary_terms_term_key" ON "glossary_terms"("term");

-- AddForeignKey
ALTER TABLE "knowledge_versions" ADD CONSTRAINT "knowledge_versions_knowledgeEntryId_fkey" FOREIGN KEY ("knowledgeEntryId") REFERENCES "knowledge_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
