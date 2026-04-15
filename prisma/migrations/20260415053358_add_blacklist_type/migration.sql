-- T1-003 addendum: add type column to blacklist_entries
-- Uses DEFAULT during ADD COLUMN to handle existing rows, then drops the
-- column-level default so Prisma's NOT NULL constraint is enforced at app layer.

-- AlterTable
ALTER TABLE "blacklist_entries" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'confidential';
ALTER TABLE "blacklist_entries" ALTER COLUMN "type" DROP DEFAULT;
