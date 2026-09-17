-- AlterTable
ALTER TABLE "teaching_logs" ADD COLUMN "signature" TEXT;

-- CreateTable
CREATE TABLE "presence_breaks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "endedAt" DATETIME,
    "minutes" INTEGER,
    "paid" BOOLEAN NOT NULL,
    "openKey" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "presence_breaks_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "presence_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_presence_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "endedAt" DATETIME,
    "durationMinutes" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "startSource" TEXT NOT NULL DEFAULT 'SELF',
    "endSource" TEXT,
    "openKey" TEXT,
    "identifierGiven" TEXT,
    "unitGiven" TEXT,
    "signature" TEXT,
    "endSignature" TEXT,
    "startDeclared" BOOLEAN NOT NULL DEFAULT false,
    "endDeclared" BOOLEAN NOT NULL DEFAULT false,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "netMinutes" INTEGER,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "presence_sessions_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_presence_sessions" ("createdAt", "durationMinutes", "endSource", "endedAt", "id", "localDate", "membershipId", "note", "openKey", "schoolId", "startSource", "startedAt", "status") SELECT "createdAt", "durationMinutes", "endSource", "endedAt", "id", "localDate", "membershipId", "note", "openKey", "schoolId", "startSource", "startedAt", "status" FROM "presence_sessions";
DROP TABLE "presence_sessions";
ALTER TABLE "new_presence_sessions" RENAME TO "presence_sessions";
CREATE UNIQUE INDEX "presence_sessions_openKey_key" ON "presence_sessions"("openKey");
CREATE INDEX "presence_sessions_schoolId_localDate_idx" ON "presence_sessions"("schoolId", "localDate");
CREATE INDEX "presence_sessions_membershipId_localDate_idx" ON "presence_sessions"("membershipId", "localDate");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "presence_breaks_openKey_key" ON "presence_breaks"("openKey");

-- CreateIndex
CREATE INDEX "presence_breaks_schoolId_sessionId_idx" ON "presence_breaks"("schoolId", "sessionId");

-- CreateIndex
CREATE INDEX "presence_breaks_sessionId_idx" ON "presence_breaks"("sessionId");
