/**
 * =============================================================================
 * SEED: DIGITAL RESOURCE LIBRARY (Phase 5)
 * =============================================================================
 *
 * Built through the real service so targeting, tag normalisation and URL
 * validation are exercised by the seed rather than bypassed by it — a
 * hand-written row is free to hold a shape the application would refuse.
 *
 * The catalogue is chosen to make the targeting VISIBLE: some material is open
 * to the whole school, some is staff-only, some is pinned to a programme or a
 * level. A seed where everything is visible to everyone proves nothing about
 * the access rules.
 *
 * Views are seeded too, and unevenly: one heavily-read text, several moderate,
 * and a few nobody has opened. The never-opened ones are the point — they are
 * what a librarian actually acts on at renewal, and they are invisible in any
 * view-weighted ranking.
 */

import type { PrismaClient } from '@prisma/client';

import { saveResource } from '../src/server/services/library.service';
import type { ResourceKind } from '../src/lib/domain/library';

interface Ctx {
  db: PrismaClient;
  schoolId: string;
}

export interface ResourceSpec {
  title: string;
  authors: string;
  description: string;
  kind: ResourceKind;
  url: string;
  publisher?: string;
  tags: string;
  audience?: 'ALL' | 'STAFF' | 'STUDENT';
  /** Programme codes, resolved to ids. */
  programCodes?: string[];
  levels?: number[];
  pageCount?: number;
  durationMin?: number;
  /** Roughly how many distinct readers to seed. */
  readers?: number;
}

export async function seedLibrary(
  ctx: Ctx,
  spec: { curatorEmail: string; resources: ResourceSpec[] },
): Promise<{ added: number; refused: number; views: number }> {
  const curator = await ctx.db.membership.findFirst({
    where: { schoolId: ctx.schoolId, user: { email: spec.curatorEmail } },
    include: { user: true },
  });
  if (!curator) return { added: 0, refused: 0, views: 0 };

  const programs = await ctx.db.program.findMany({
    where: { schoolId: ctx.schoolId },
    select: { id: true, code: true },
  });
  const programByCode = new Map(programs.map((p) => [p.code, p.id]));

  let added = 0;
  let refused = 0;
  const created: { id: string; readers: number }[] = [];

  for (const r of spec.resources) {
    const result = await saveResource({
      schoolId: ctx.schoolId,
      title: r.title,
      authors: r.authors,
      description: r.description,
      kind: r.kind,
      url: r.url,
      publisher: r.publisher ?? null,
      tags: r.tags,
      audience: r.audience ?? 'ALL',
      programIds: (r.programCodes ?? [])
        .map((c) => programByCode.get(c))
        .filter((id): id is string => Boolean(id)),
      yearGroupIds: [],
      levels: r.levels ?? [],
      pageCount: r.pageCount ?? null,
      durationMin: r.durationMin ?? null,
      publish: true,
      actorMembershipId: curator.id,
      actorUserId: curator.userId,
    });

    if (result.ok && result.resourceId) {
      added += 1;
      created.push({ id: result.resourceId, readers: r.readers ?? 0 });
    } else {
      refused += 1;
    }
  }

  // --- seeded readership -----------------------------------------------------
  // Written directly rather than through `recordView`, because that function
  // deliberately refuses more than one view per person per 30 minutes — which
  // is correct behaviour and exactly wrong for building a history in a loop.
  // The counter is set to match the rows, so the denormalised value and the
  // source of truth agree.
  const readers = await ctx.db.membership.findMany({
    where: { schoolId: ctx.schoolId, role: { in: ['STUDENT', 'INSTRUCTOR'] }, status: 'ACTIVE' },
    select: { id: true },
  });

  let views = 0;
  for (const [index, resource] of created.entries()) {
    if (resource.readers === 0 || readers.length === 0) continue;

    const rows: { schoolId: string; resourceId: string; membershipId: string; viewedAt: Date }[] = [];
    for (let i = 0; i < resource.readers; i += 1) {
      const reader = readers[(index + i) % readers.length];
      // Spread across the last ~10 weeks so the 7- and 30-day windows on the
      // analytics page differ from the total.
      const daysBack = ((index * 7 + i * 11) % 70) + 1;
      rows.push({
        schoolId: ctx.schoolId,
        resourceId: resource.id,
        membershipId: reader.id,
        viewedAt: new Date(Date.now() - daysBack * 86_400_000),
      });
    }

    await ctx.db.resourceView.createMany({ data: rows });
    await ctx.db.libraryResource.update({
      where: { id: resource.id },
      data: { viewCount: rows.length },
    });
    views += rows.length;
  }

  return { added, refused, views };
}

// -----------------------------------------------------------------------------
// Golden Eagles University
// -----------------------------------------------------------------------------

export const GEU_RESOURCES: ResourceSpec[] = [
  {
    title: 'Introduction to Algorithms',
    authors: 'Cormen, Leiserson, Rivest, Stein',
    description: 'The standard reference for algorithm design and analysis. Core text for CSC201.',
    kind: 'EBOOK',
    url: 'https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/',
    publisher: 'MIT Press',
    tags: 'algorithms, computer science, data structures',
    pageCount: 1312,
    readers: 9,
  },
  {
    title: 'Linear Algebra Done Right',
    authors: 'Sheldon Axler',
    description: 'Determinant-free treatment of vector spaces and linear maps. Recommended for MTH102.',
    kind: 'EBOOK',
    url: 'https://linear.axler.net/',
    publisher: 'Springer',
    tags: 'algebra, mathematics, linear algebra',
    pageCount: 340,
    readers: 6,
  },
  {
    title: 'Structure and Interpretation of Computer Programs',
    authors: 'Abelson & Sussman',
    description: 'Foundational text on abstraction and program structure.',
    kind: 'EBOOK',
    url: 'https://mitp-content-server.mit.edu/books/content/sectbyfn/books_pres_0/6515/sicp.zip/index.html',
    publisher: 'MIT Press',
    tags: 'computer science, programming, abstraction',
    levels: [200, 300],
    readers: 4,
  },
  {
    title: 'Database System Concepts',
    authors: 'Silberschatz, Korth, Sudarshan',
    description: 'Relational theory, transactions and recovery. Set text for CSC302.',
    kind: 'EBOOK',
    url: 'https://www.db-book.com/',
    tags: 'databases, computer science',
    levels: [300, 400],
    readers: 3,
  },
  {
    title: 'Academic Integrity: what counts as plagiarism',
    authors: 'Office of the Registrar',
    description: 'What constitutes plagiarism, collusion and contract cheating, and what happens next.',
    kind: 'DOCUMENT',
    url: '/library/docs/academic-integrity',
    tags: 'policy, academic integrity, study skills',
    readers: 11,
  },
  {
    title: 'Writing a first-class laboratory report',
    authors: 'Faculty of Engineering',
    description: 'Structure, figures, error analysis and referencing for engineering lab reports.',
    kind: 'DOCUMENT',
    url: '/library/docs/lab-reports',
    tags: 'study skills, engineering, writing',
    readers: 2,
  },
  {
    title: 'Lecture series: Calculus I refresher',
    authors: 'Dr Fatima Dauda',
    description: 'Six recorded sessions covering limits, differentiation and applications.',
    kind: 'VIDEO',
    url: 'https://example.edu/media/calculus-refresher',
    tags: 'mathematics, calculus, revision',
    durationMin: 340,
    levels: [100],
    readers: 5,
  },
  {
    title: 'Nigerian Universities Commission — benchmark statements',
    authors: 'NUC',
    description: 'Minimum academic standards by discipline.',
    kind: 'LINK',
    url: 'https://www.nuc.edu.ng/',
    tags: 'accreditation, policy',
    audience: 'STAFF',
    readers: 3,
  },
  {
    title: 'Examination moderation handbook',
    authors: 'Academic Board',
    description:
      'Internal guidance on setting, moderating and second-marking examinations. Staff only.',
    kind: 'DOCUMENT',
    url: '/library/docs/moderation-handbook',
    tags: 'assessment, policy, moderation',
    audience: 'STAFF',
    readers: 4,
  },
  {
    title: 'Safeguarding and student welfare procedures',
    authors: 'Registrar’s Office',
    description: 'Confidential procedural guidance for staff.',
    kind: 'DOCUMENT',
    url: '/library/docs/safeguarding',
    tags: 'policy, welfare, safeguarding',
    audience: 'STAFF',
    readers: 0,
  },
  {
    title: 'Open dataset: Nigerian tertiary enrolment 2015-2024',
    authors: 'National Bureau of Statistics',
    description: 'Enrolment by institution, discipline and gender. Useful for statistics coursework.',
    kind: 'DATASET',
    url: 'https://nigerianstat.gov.ng/',
    tags: 'data, statistics, enrolment',
    readers: 0,
  },
  {
    title: 'Discrete Mathematics and Its Applications',
    authors: 'Kenneth H. Rosen',
    description: 'Logic, sets, combinatorics and graph theory. Companion text for CSC202.',
    kind: 'EBOOK',
    url: 'https://example.edu/library/rosen-discrete',
    tags: 'mathematics, discrete mathematics, computer science',
    pageCount: 1120,
    readers: 0,
  },
];

// -----------------------------------------------------------------------------
// Meridian Institute of Technology
// -----------------------------------------------------------------------------

export const MIT_RESOURCES: ResourceSpec[] = [
  {
    title: 'The Pragmatic Programmer',
    authors: 'Hunt & Thomas',
    description: 'Craft, tooling and judgement in software construction. Core for SWE101.',
    kind: 'EBOOK',
    url: 'https://pragprog.com/titles/tpp20/the-pragmatic-programmer-20th-anniversary-edition/',
    tags: 'software engineering, craft, programming',
    readers: 4,
  },
  {
    title: 'An Introduction to Statistical Learning',
    authors: 'James, Witten, Hastie, Tibshirani',
    description: 'Accessible treatment of supervised and unsupervised methods. Set text for DAT201.',
    kind: 'EBOOK',
    url: 'https://www.statlearning.com/',
    tags: 'machine learning, statistics, data science',
    pageCount: 615,
    readers: 3,
  },
  {
    title: 'Software Architecture in Practice',
    authors: 'Bass, Clements, Kazman',
    description: 'Quality attributes, tactics and architectural decision records.',
    kind: 'EBOOK',
    url: 'https://example.edu/library/software-architecture',
    tags: 'software engineering, architecture',
    levels: [200, 300],
    readers: 2,
  },
  {
    title: 'Meridian academic regulations 2025/2026',
    authors: 'Registry',
    description: 'Grading on the 5.0 scale, progression rules and degree classification.',
    kind: 'DOCUMENT',
    url: '/library/docs/meridian-regulations',
    tags: 'policy, regulations, grading',
    readers: 5,
  },
  {
    title: 'External examiner guidance',
    authors: 'Academic Board',
    description: 'For internal circulation among teaching staff.',
    kind: 'DOCUMENT',
    url: '/library/docs/external-examiners',
    tags: 'assessment, policy',
    audience: 'STAFF',
    readers: 0,
  },
];
