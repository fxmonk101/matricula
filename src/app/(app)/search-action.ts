'use server';

import { requireTenantContext } from '@/server/tenant-context';
import { can } from '@/lib/auth/rbac';
import { canReadAudience } from '@/lib/domain/forum';
import { canAccessResource } from '@/lib/domain/library';
import { resolveViewer } from '@/server/services/library.service';
import type { ForumAudience } from '@/lib/domain/enums';

export interface SearchHit {
  id: string;
  kind: 'Student' | 'Course' | 'Task' | 'Resource' | 'Discussion' | 'Person';
  title: string;
  subtitle: string;
  href: string;
}

/**
 * Global search behind the command palette.
 *
 * EVERY branch re-checks authorisation rather than relying on the palette
 * hiding what a role cannot use. A search box is the easiest place in an
 * application to leak the existence of records: it accepts free text, it
 * queries several tables, and the results are terse enough that nobody notices
 * one row that should not be there. So the rule here is that a hit is only
 * emitted after the same predicate the corresponding page would apply.
 *
 * Results are capped per section so one matching table cannot crowd out the
 * others — a search for "a" should show a spread, not forty students.
 */
export async function globalSearch(query: string): Promise<SearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const { db, schoolId, role, session, membershipId } = await requireTenantContext();
  const hits: SearchHit[] = [];
  const take = 4;

  // --- people ---------------------------------------------------------------
  if (can(role, 'student:read')) {
    const students = await db.student.findMany({
      where: {
        OR: [
          { matricNumber: { contains: q, mode: 'insensitive' as const } },
          { user: { firstName: { contains: q, mode: 'insensitive' as const } } },
          { user: { lastName: { contains: q, mode: 'insensitive' as const } } },
          { user: { email: { contains: q, mode: 'insensitive' as const } } },
        ],
      },
      include: { user: true, program: { select: { code: true } } },
      take,
    });
    for (const s of students) {
      hits.push({
        id: s.id,
        kind: 'Student',
        title: `${s.user.firstName} ${s.user.lastName}`,
        subtitle: `${s.matricNumber} · ${s.program?.code ?? 'no programme'}`,
        href: `/students/${s.id}`,
      });
    }
  }

  // --- curriculum -----------------------------------------------------------
  if (can(role, 'course:read')) {
    const courses = await db.course.findMany({
      where: { OR: [{ code: { contains: q, mode: 'insensitive' as const } }, { title: { contains: q, mode: 'insensitive' as const } }] },
      take,
    });
    for (const c of courses) {
      hits.push({
        id: c.id,
        kind: 'Course',
        title: `${c.code} — ${c.title}`,
        subtitle: `${c.creditHours} credit hours · level ${c.level}`,
        href: `/courses`,
      });
    }
  }

  // --- tasks ----------------------------------------------------------------
  // Scoped to this person's own queue and the work they raised. Somebody
  // else's task is a record-level question the palette has no business
  // answering, so it simply does not search them.
  if (can(role, 'task:read:own')) {
    const tasks = await db.task.findMany({
      where: {
        title: { contains: q, mode: 'insensitive' as const },
        OR: [{ assigneeId: membershipId }, { assignerId: membershipId }],
      },
      take,
    });
    for (const t of tasks) {
      hits.push({
        id: t.id,
        kind: 'Task',
        title: t.title,
        subtitle: `${t.status.toLowerCase().replace('_', ' ')} · ${t.priority.toLowerCase()}`,
        href: `/tasks/${t.id}`,
      });
    }
  }

  // --- library --------------------------------------------------------------
  if (can(role, 'library:read')) {
    const viewer = await resolveViewer(schoolId, role, session.sub);
    const resources = await db.libraryResource.findMany({
      where: {
        isArchived: false,
        publishedAt: { not: null },
        OR: [{ title: { contains: q, mode: 'insensitive' as const } }, { authors: { contains: q, mode: 'insensitive' as const } }, { tags: { contains: q, mode: 'insensitive' as const } }],
      },
      take: take * 3,
    });
    for (const r of resources) {
      const allowed = canAccessResource(viewer, {
        audience: r.audience as 'ALL' | 'STAFF' | 'STUDENT',
        programIds: safeArray<string>(r.programIdsJson),
        yearGroupIds: safeArray<string>(r.yearGroupIdsJson),
        levels: safeArray<number>(r.levelsJson),
      });
      if (!allowed) continue;
      hits.push({
        id: r.id,
        kind: 'Resource',
        title: r.title,
        subtitle: r.authors || r.kind.toLowerCase(),
        href: `/library/${r.id}`,
      });
      if (hits.filter((h) => h.kind === 'Resource').length >= take) break;
    }
  }

  // --- forums ---------------------------------------------------------------
  if (can(role, 'forum:read')) {
    const threads = await db.thread.findMany({
      where: { title: { contains: q, mode: 'insensitive' as const }, status: { in: ['OPEN', 'LOCKED'] } },
      include: { forum: true },
      take: take * 3,
    });
    for (const t of threads) {
      if (!canReadAudience(role, t.forum.audience as ForumAudience)) continue;
      hits.push({
        id: t.id,
        kind: 'Discussion',
        title: t.title,
        subtitle: `${t.forum.name} · ${t.postCount} posts`,
        href: `/forums/${t.forum.slug}/${t.id}`,
      });
      if (hits.filter((h) => h.kind === 'Discussion').length >= take) break;
    }
  }

  return hits;
}

function safeArray<T>(raw: string): T[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}
