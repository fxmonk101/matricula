-- AlterTable
ALTER TABLE "school_configs" ADD COLUMN "k12Json" TEXT;

-- CreateTable
CREATE TABLE "year_groups" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "isTerminal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "form_classes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "yearGroupId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "formTeacherId" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 30,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "form_classes_yearGroupId_fkey" FOREIGN KEY ("yearGroupId") REFERENCES "year_groups" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "form_classes_formTeacherId_fkey" FOREIGN KEY ("formTeacherId") REFERENCES "instructors" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "subjects" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "yearGroupId" TEXT,
    "isCore" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "subjects_yearGroupId_fkey" FOREIGN KEY ("yearGroupId") REFERENCES "year_groups" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "subject_assignments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "formClassId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "teacherId" TEXT,
    "marksPosted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "subject_assignments_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "subject_assignments_formClassId_fkey" FOREIGN KEY ("formClassId") REFERENCES "form_classes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "subject_assignments_termId_fkey" FOREIGN KEY ("termId") REFERENCES "terms" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "subject_assignments_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "instructors" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "class_enrolments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "formClassId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "class_enrolments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "class_enrolments_formClassId_fkey" FOREIGN KEY ("formClassId") REFERENCES "form_classes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "class_enrolments_termId_fkey" FOREIGN KEY ("termId") REFERENCES "terms" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "subject_results" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "caScore" REAL,
    "examScore" REAL,
    "totalScore" REAL,
    "letterGrade" TEXT,
    "gradePoint" REAL,
    "positionInClass" INTEGER,
    "classAverage" REAL,
    "remark" TEXT,
    "gradedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "subject_results_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "subject_results_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "subject_assignments" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "recordedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "attendance_records_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "attendance_records_termId_fkey" FOREIGN KEY ("termId") REFERENCES "terms" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "report_cards" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "referenceNo" TEXT NOT NULL,
    "formClassCode" TEXT NOT NULL,
    "totalMarks" REAL NOT NULL,
    "maxMarks" REAL NOT NULL,
    "average" REAL NOT NULL,
    "classAverage" REAL NOT NULL,
    "positionInClass" INTEGER NOT NULL,
    "classSize" INTEGER NOT NULL,
    "overallGrade" TEXT NOT NULL,
    "daysPresent" INTEGER NOT NULL DEFAULT 0,
    "daysAbsent" INTEGER NOT NULL DEFAULT 0,
    "daysLate" INTEGER NOT NULL DEFAULT 0,
    "daysInTerm" INTEGER NOT NULL DEFAULT 0,
    "promotionDecision" TEXT NOT NULL DEFAULT 'PENDING',
    "promotionReason" TEXT,
    "classTeacherRemark" TEXT,
    "headTeacherRemark" TEXT,
    "traitsJson" TEXT,
    "publishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "report_cards_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "report_cards_termId_fkey" FOREIGN KEY ("termId") REFERENCES "terms" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "report_card_lines" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "reportCardId" TEXT NOT NULL,
    "subjectCode" TEXT NOT NULL,
    "subjectName" TEXT NOT NULL,
    "caScore" REAL,
    "examScore" REAL,
    "totalScore" REAL,
    "letterGrade" TEXT,
    "classAverage" REAL,
    "positionInClass" INTEGER,
    "remark" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "report_card_lines_reportCardId_fkey" FOREIGN KEY ("reportCardId") REFERENCES "report_cards" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "guardians" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "occupation" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "guardians_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "guardian_students" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "guardianId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "relationship" TEXT NOT NULL DEFAULT 'GUARDIAN',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "canViewFinance" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "guardian_students_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "guardians" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "guardian_students_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "year_groups_schoolId_sequence_idx" ON "year_groups"("schoolId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "year_groups_schoolId_code_key" ON "year_groups"("schoolId", "code");

-- CreateIndex
CREATE INDEX "form_classes_schoolId_yearGroupId_idx" ON "form_classes"("schoolId", "yearGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "form_classes_schoolId_code_key" ON "form_classes"("schoolId", "code");

-- CreateIndex
CREATE INDEX "subjects_schoolId_yearGroupId_idx" ON "subjects"("schoolId", "yearGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "subjects_schoolId_code_key" ON "subjects"("schoolId", "code");

-- CreateIndex
CREATE INDEX "subject_assignments_schoolId_termId_idx" ON "subject_assignments"("schoolId", "termId");

-- CreateIndex
CREATE INDEX "subject_assignments_teacherId_idx" ON "subject_assignments"("teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "subject_assignments_subjectId_formClassId_termId_key" ON "subject_assignments"("subjectId", "formClassId", "termId");

-- CreateIndex
CREATE INDEX "class_enrolments_schoolId_formClassId_termId_idx" ON "class_enrolments"("schoolId", "formClassId", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "class_enrolments_studentId_termId_key" ON "class_enrolments"("studentId", "termId");

-- CreateIndex
CREATE INDEX "subject_results_schoolId_assignmentId_idx" ON "subject_results"("schoolId", "assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "subject_results_studentId_assignmentId_key" ON "subject_results"("studentId", "assignmentId");

-- CreateIndex
CREATE INDEX "attendance_records_schoolId_termId_date_idx" ON "attendance_records"("schoolId", "termId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_studentId_date_key" ON "attendance_records"("studentId", "date");

-- CreateIndex
CREATE INDEX "report_cards_schoolId_termId_idx" ON "report_cards"("schoolId", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "report_cards_studentId_termId_key" ON "report_cards"("studentId", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "report_cards_schoolId_referenceNo_key" ON "report_cards"("schoolId", "referenceNo");

-- CreateIndex
CREATE INDEX "report_card_lines_reportCardId_idx" ON "report_card_lines"("reportCardId");

-- CreateIndex
CREATE INDEX "guardians_schoolId_idx" ON "guardians"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "guardians_schoolId_userId_key" ON "guardians"("schoolId", "userId");

-- CreateIndex
CREATE INDEX "guardian_students_schoolId_studentId_idx" ON "guardian_students"("schoolId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "guardian_students_guardianId_studentId_key" ON "guardian_students"("guardianId", "studentId");
