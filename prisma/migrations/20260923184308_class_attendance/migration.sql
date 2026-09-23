-- CreateTable
CREATE TABLE "class_attendance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "teachingLogId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "markedById" TEXT,
    "markedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "class_attendance_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "class_attendance_teachingLogId_fkey" FOREIGN KEY ("teachingLogId") REFERENCES "teaching_logs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "class_attendance_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "enrollments" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "class_attendance_markedById_fkey" FOREIGN KEY ("markedById") REFERENCES "memberships" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "class_attendance_schoolId_teachingLogId_idx" ON "class_attendance"("schoolId", "teachingLogId");

-- CreateIndex
CREATE INDEX "class_attendance_enrollmentId_idx" ON "class_attendance"("enrollmentId");

-- CreateIndex
CREATE UNIQUE INDEX "class_attendance_teachingLogId_enrollmentId_key" ON "class_attendance"("teachingLogId", "enrollmentId");
