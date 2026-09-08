-- CreateTable
CREATE TABLE "forums" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "audience" TEXT NOT NULL DEFAULT 'STUDENT',
    "position" INTEGER NOT NULL DEFAULT 0,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "forums_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "forum_categories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "forumId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "forum_categories_forumId_fkey" FOREIGN KEY ("forumId") REFERENCES "forums" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "threads" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "forumId" TEXT NOT NULL,
    "categoryId" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "authorId" TEXT,
    "postCount" INTEGER NOT NULL DEFAULT 0,
    "reactionCount" INTEGER NOT NULL DEFAULT 0,
    "reportCount" INTEGER NOT NULL DEFAULT 0,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastPostAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "threads_forumId_fkey" FOREIGN KEY ("forumId") REFERENCES "forums" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "threads_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "forum_categories" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "threads_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "memberships" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "posts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "isOpeningPost" BOOLEAN NOT NULL DEFAULT false,
    "reactionCount" INTEGER NOT NULL DEFAULT 0,
    "reportCount" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "editedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "posts_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "threads" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "posts_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "memberships" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "post_reactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'LIKE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "post_reactions_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "post_reactions_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "post_reports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "postId" TEXT,
    "threadId" TEXT,
    "reporterId" TEXT,
    "reason" TEXT NOT NULL,
    "detail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "taskId" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" DATETIME,
    "resolution" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "post_reports_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "post_reports_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "threads" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "post_reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "memberships" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "post_reports_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "memberships" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "forums_schoolId_audience_idx" ON "forums"("schoolId", "audience");

-- CreateIndex
CREATE UNIQUE INDEX "forums_schoolId_slug_key" ON "forums"("schoolId", "slug");

-- CreateIndex
CREATE INDEX "forum_categories_schoolId_idx" ON "forum_categories"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "forum_categories_forumId_slug_key" ON "forum_categories"("forumId", "slug");

-- CreateIndex
CREATE INDEX "threads_schoolId_forumId_status_idx" ON "threads"("schoolId", "forumId", "status");

-- CreateIndex
CREATE INDEX "threads_forumId_isPinned_lastPostAt_idx" ON "threads"("forumId", "isPinned", "lastPostAt");

-- CreateIndex
CREATE INDEX "posts_threadId_createdAt_idx" ON "posts"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "posts_schoolId_authorId_createdAt_idx" ON "posts"("schoolId", "authorId", "createdAt");

-- CreateIndex
CREATE INDEX "post_reactions_schoolId_idx" ON "post_reactions"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "post_reactions_postId_membershipId_key" ON "post_reactions"("postId", "membershipId");

-- CreateIndex
CREATE INDEX "post_reports_schoolId_status_idx" ON "post_reports"("schoolId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "post_reports_postId_reporterId_key" ON "post_reports"("postId", "reporterId");
