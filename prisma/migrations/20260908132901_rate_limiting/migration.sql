-- CreateTable
CREATE TABLE "rate_limit_hits" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT,
    "action" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "rate_limit_hits_action_identifier_createdAt_idx" ON "rate_limit_hits"("action", "identifier", "createdAt");

-- CreateIndex
CREATE INDEX "rate_limit_hits_action_address_createdAt_idx" ON "rate_limit_hits"("action", "address", "createdAt");

-- CreateIndex
CREATE INDEX "rate_limit_hits_createdAt_idx" ON "rate_limit_hits"("createdAt");
