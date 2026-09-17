-- AlterTable
ALTER TABLE "users" ADD COLUMN "avatarKey" TEXT;

-- CreateTable
CREATE TABLE "account_change_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "summary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "account_change_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "account_change_requests_tokenHash_key" ON "account_change_requests"("tokenHash");

-- CreateIndex
CREATE INDEX "account_change_requests_userId_kind_idx" ON "account_change_requests"("userId", "kind");

-- CreateIndex
CREATE INDEX "account_change_requests_expiresAt_idx" ON "account_change_requests"("expiresAt");
