-- CreateTable
CREATE TABLE "course_spaces" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "offeringId" TEXT,
    "subjectAssignmentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "course_spaces_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "course_spaces_termId_fkey" FOREIGN KEY ("termId") REFERENCES "terms" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "course_spaces_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "course_offerings" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "course_spaces_subjectAssignmentId_fkey" FOREIGN KEY ("subjectAssignmentId") REFERENCES "subject_assignments" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "course_modules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "unlockAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "course_modules_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "course_modules_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "course_spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "module_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "bodyMarkdown" TEXT,
    "externalUrl" TEXT,
    "fileKey" TEXT,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "module_items_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "module_items_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "course_modules" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "coursework" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "moduleItemId" TEXT NOT NULL,
    "instructions" TEXT,
    "pointsPossible" REAL NOT NULL DEFAULT 100,
    "dueAt" DATETIME,
    "acceptsLate" BOOLEAN NOT NULL DEFAULT true,
    "allowsText" BOOLEAN NOT NULL DEFAULT true,
    "allowsFile" BOOLEAN NOT NULL DEFAULT true,
    "rubricJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "coursework_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "coursework_moduleItemId_fkey" FOREIGN KEY ("moduleItemId") REFERENCES "module_items" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "courseworkId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "textBody" TEXT,
    "fileKey" TEXT,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isLate" BOOLEAN NOT NULL DEFAULT false,
    "score" REAL,
    "feedback" TEXT,
    "rubricJson" TEXT,
    "gradedById" TEXT,
    "gradedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "submissions_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "submissions_courseworkId_fkey" FOREIGN KEY ("courseworkId") REFERENCES "coursework" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "submissions_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "enrollments" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "submissions_gradedById_fkey" FOREIGN KEY ("gradedById") REFERENCES "memberships" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "virtual_classes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "moduleItemId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'MANUAL',
    "joinUrl" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "externalId" TEXT,
    "organiserMembershipId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "virtual_classes_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "virtual_classes_moduleItemId_fkey" FOREIGN KEY ("moduleItemId") REFERENCES "module_items" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "virtual_classes_organiserMembershipId_fkey" FOREIGN KEY ("organiserMembershipId") REFERENCES "memberships" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "course_spaces_offeringId_key" ON "course_spaces"("offeringId");

-- CreateIndex
CREATE UNIQUE INDEX "course_spaces_subjectAssignmentId_key" ON "course_spaces"("subjectAssignmentId");

-- CreateIndex
CREATE INDEX "course_spaces_schoolId_termId_idx" ON "course_spaces"("schoolId", "termId");

-- CreateIndex
CREATE INDEX "course_modules_schoolId_spaceId_idx" ON "course_modules"("schoolId", "spaceId");

-- CreateIndex
CREATE INDEX "course_modules_spaceId_position_idx" ON "course_modules"("spaceId", "position");

-- CreateIndex
CREATE INDEX "module_items_schoolId_moduleId_idx" ON "module_items"("schoolId", "moduleId");

-- CreateIndex
CREATE INDEX "module_items_moduleId_position_idx" ON "module_items"("moduleId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "coursework_moduleItemId_key" ON "coursework"("moduleItemId");

-- CreateIndex
CREATE INDEX "coursework_schoolId_idx" ON "coursework"("schoolId");

-- CreateIndex
CREATE INDEX "submissions_schoolId_courseworkId_idx" ON "submissions"("schoolId", "courseworkId");

-- CreateIndex
CREATE INDEX "submissions_enrollmentId_idx" ON "submissions"("enrollmentId");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_courseworkId_enrollmentId_attempt_key" ON "submissions"("courseworkId", "enrollmentId", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "virtual_classes_moduleItemId_key" ON "virtual_classes"("moduleItemId");

-- CreateIndex
CREATE INDEX "virtual_classes_schoolId_startsAt_idx" ON "virtual_classes"("schoolId", "startsAt");
