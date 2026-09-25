-- CreateTable
CREATE TABLE "result_sheets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'DRAFT',
    "returnedReason" TEXT,
    "releasedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "result_sheets_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "result_sheets_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "course_offerings" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "result_steps" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "byId" TEXT,
    "note" TEXT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "result_steps_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "result_steps_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "result_sheets" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "result_steps_byId_fkey" FOREIGN KEY ("byId") REFERENCES "memberships" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "result_sheets_offeringId_key" ON "result_sheets"("offeringId");

-- CreateIndex
CREATE INDEX "result_sheets_schoolId_stage_idx" ON "result_sheets"("schoolId", "stage");

-- CreateIndex
CREATE INDEX "result_steps_schoolId_sheetId_idx" ON "result_steps"("schoolId", "sheetId");
