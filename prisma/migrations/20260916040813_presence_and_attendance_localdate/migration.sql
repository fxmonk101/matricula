/*
  Warnings:

  - You are about to drop the column `date` on the `attendance_records` table. All the data in the column will be lost.
  - You are about to drop the column `recordedBy` on the `attendance_records` table. All the data in the column will be lost.
  - Added the required column `localDate` to the `attendance_records` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "presence_sessions" (
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
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "presence_sessions_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "presence_corrections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "previousValue" TEXT,
    "newValue" TEXT,
    "reason" TEXT NOT NULL,
    "correctedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "presence_corrections_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "presence_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "presence_corrections_correctedById_fkey" FOREIGN KEY ("correctedById") REFERENCES "memberships" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "teaching_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "offeringId" TEXT,
    "localDate" TEXT NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DELIVERED',
    "topic" TEXT,
    "note" TEXT,
    "attended" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "teaching_logs_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "teaching_logs_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "course_offerings" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_attendance_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "sessionKey" TEXT NOT NULL DEFAULT 'DAY',
    "status" TEXT NOT NULL,
    "note" TEXT,
    "recordedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "attendance_records_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "attendance_records_termId_fkey" FOREIGN KEY ("termId") REFERENCES "terms" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "attendance_records_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "memberships" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_attendance_records" ("createdAt", "id", "note", "schoolId", "status", "studentId", "termId") SELECT "createdAt", "id", "note", "schoolId", "status", "studentId", "termId" FROM "attendance_records";
DROP TABLE "attendance_records";
ALTER TABLE "new_attendance_records" RENAME TO "attendance_records";
CREATE INDEX "attendance_records_schoolId_termId_localDate_idx" ON "attendance_records"("schoolId", "termId", "localDate");
CREATE UNIQUE INDEX "attendance_records_studentId_localDate_sessionKey_key" ON "attendance_records"("studentId", "localDate", "sessionKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "presence_sessions_openKey_key" ON "presence_sessions"("openKey");

-- CreateIndex
CREATE INDEX "presence_sessions_schoolId_localDate_idx" ON "presence_sessions"("schoolId", "localDate");

-- CreateIndex
CREATE INDEX "presence_sessions_membershipId_localDate_idx" ON "presence_sessions"("membershipId", "localDate");

-- CreateIndex
CREATE INDEX "presence_corrections_schoolId_sessionId_idx" ON "presence_corrections"("schoolId", "sessionId");

-- CreateIndex
CREATE INDEX "teaching_logs_schoolId_localDate_idx" ON "teaching_logs"("schoolId", "localDate");

-- CreateIndex
CREATE INDEX "teaching_logs_membershipId_localDate_idx" ON "teaching_logs"("membershipId", "localDate");

-- CreateIndex
CREATE INDEX "teaching_logs_offeringId_idx" ON "teaching_logs"("offeringId");
