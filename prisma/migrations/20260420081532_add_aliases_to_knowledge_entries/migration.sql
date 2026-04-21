-- AlterTable
ALTER TABLE "knowledge_entries" ADD COLUMN     "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[];
