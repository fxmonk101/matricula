-- CreateTable
CREATE TABLE "library_resources" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "authors" TEXT NOT NULL DEFAULT '',
    "description" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'DOCUMENT',
    "url" TEXT NOT NULL,
    "publisher" TEXT,
    "isbn" TEXT,
    "edition" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "pageCount" INTEGER,
    "durationMin" INTEGER,
    "tags" TEXT NOT NULL DEFAULT '',
    "audience" TEXT NOT NULL DEFAULT 'ALL',
    "programIdsJson" TEXT NOT NULL DEFAULT '[]',
    "yearGroupIdsJson" TEXT NOT NULL DEFAULT '[]',
    "levelsJson" TEXT NOT NULL DEFAULT '[]',
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "addedById" TEXT,
    "publishedAt" DATETIME,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "library_resources_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "library_resources_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "memberships" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "resource_collections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "audience" TEXT NOT NULL DEFAULT 'ALL',
    "curatorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "resource_collections_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "resource_collections_curatorId_fkey" FOREIGN KEY ("curatorId") REFERENCES "memberships" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "resource_collection_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "note" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "resource_collection_items_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "resource_collections" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "resource_collection_items_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "library_resources" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "resource_views" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "membershipId" TEXT,
    "viewedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "resource_views_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "library_resources" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "resource_views_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "library_resources_schoolId_isArchived_publishedAt_idx" ON "library_resources"("schoolId", "isArchived", "publishedAt");

-- CreateIndex
CREATE INDEX "library_resources_schoolId_kind_idx" ON "library_resources"("schoolId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "resource_collections_schoolId_slug_key" ON "resource_collections"("schoolId", "slug");

-- CreateIndex
CREATE INDEX "resource_collection_items_schoolId_idx" ON "resource_collection_items"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "resource_collection_items_collectionId_resourceId_key" ON "resource_collection_items"("collectionId", "resourceId");

-- CreateIndex
CREATE INDEX "resource_views_resourceId_viewedAt_idx" ON "resource_views"("resourceId", "viewedAt");

-- CreateIndex
CREATE INDEX "resource_views_schoolId_membershipId_viewedAt_idx" ON "resource_views"("schoolId", "membershipId", "viewedAt");
