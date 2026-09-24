-- CreateTable
CREATE TABLE "quizzes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "courseworkId" TEXT NOT NULL,
    "timeLimitMinutes" INTEGER,
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "shuffleQuestions" BOOLEAN NOT NULL DEFAULT false,
    "shuffleOptions" BOOLEAN NOT NULL DEFAULT false,
    "reveal" TEXT NOT NULL DEFAULT 'AFTER_DUE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "quizzes_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "quizzes_courseworkId_fkey" FOREIGN KEY ("courseworkId") REFERENCES "coursework" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "quiz_questions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "points" REAL NOT NULL DEFAULT 1,
    "acceptedAnswers" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "quiz_questions_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "quiz_questions_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "quizzes" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "quiz_options" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "quiz_options_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "quiz_options_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "quiz_questions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "quiz_attempts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" DATETIME,
    "orderJson" TEXT NOT NULL,
    "answersJson" TEXT NOT NULL DEFAULT '[]',
    "autoScore" REAL,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "submissionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "quiz_attempts_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "quiz_attempts_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "quizzes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "quiz_attempts_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "enrollments" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "quizzes_courseworkId_key" ON "quizzes"("courseworkId");

-- CreateIndex
CREATE INDEX "quizzes_schoolId_idx" ON "quizzes"("schoolId");

-- CreateIndex
CREATE INDEX "quiz_questions_schoolId_quizId_idx" ON "quiz_questions"("schoolId", "quizId");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_questions_quizId_position_key" ON "quiz_questions"("quizId", "position");

-- CreateIndex
CREATE INDEX "quiz_options_schoolId_questionId_idx" ON "quiz_options"("schoolId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_options_questionId_position_key" ON "quiz_options"("questionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_attempts_submissionId_key" ON "quiz_attempts"("submissionId");

-- CreateIndex
CREATE INDEX "quiz_attempts_schoolId_quizId_idx" ON "quiz_attempts"("schoolId", "quizId");

-- CreateIndex
CREATE INDEX "quiz_attempts_enrollmentId_idx" ON "quiz_attempts"("enrollmentId");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_attempts_quizId_enrollmentId_attempt_key" ON "quiz_attempts"("quizId", "enrollmentId", "attempt");
