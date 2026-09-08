/**
 * =============================================================================
 * SEED: FORUMS (Phase 4)
 * =============================================================================
 *
 * Threads and posts are created through the real service, so the denormalised
 * counters, the mention fan-out and the rate limits are exercised by the seed
 * rather than bypassed by it. `skipRateLimit` is the one concession — a seed
 * writes twenty posts in two seconds, which is precisely what the limiter
 * exists to stop.
 *
 * The content is chosen to make the FEATURES visible: a pinned notice, a locked
 * thread, a reported thread sitting in the moderation queue, a post with a
 * mention, and one post exercising every markdown construct the renderer
 * supports — including a code block, which is where a naive renderer breaks.
 */

import type { PrismaClient } from '@prisma/client';

import { createPost, createThread, reportContent } from '../src/server/services/forum.service';
import { moderateThread } from '../src/server/services/forum.service';

interface Ctx {
  db: PrismaClient;
  schoolId: string;
}

interface ForumSpec {
  slug: string;
  name: string;
  description: string;
  audience: 'STAFF' | 'STUDENT' | 'ALL';
  categories: { slug: string; name: string; description: string }[];
}

interface ThreadSpec {
  forum: string;
  category?: string;
  author: string;
  title: string;
  body: string;
  replies?: { author: string; body: string }[];
  pin?: boolean;
  lock?: boolean;
  report?: { by: string; reason: 'SPAM' | 'ABUSE' | 'OFF_TOPIC' | 'PERSONAL_DATA' | 'ACADEMIC_DISHONESTY' | 'OTHER'; detail?: string };
}

async function memberOf(ctx: Ctx, email: string) {
  return ctx.db.membership.findFirst({
    where: { schoolId: ctx.schoolId, user: { email } },
    include: { user: true },
  });
}

export async function seedForums(
  ctx: Ctx,
  spec: { forums: ForumSpec[]; threads: ThreadSpec[] },
): Promise<{ forums: number; threads: number; posts: number }> {
  const forumIds = new Map<string, string>();
  const categoryIds = new Map<string, string>();

  for (const [index, f] of spec.forums.entries()) {
    const forum = await ctx.db.forum.create({
      data: {
        schoolId: ctx.schoolId,
        slug: f.slug,
        name: f.name,
        description: f.description,
        audience: f.audience,
        position: index,
      },
    });
    forumIds.set(f.slug, forum.id);

    for (const [ci, c] of f.categories.entries()) {
      const category = await ctx.db.forumCategory.create({
        data: {
          schoolId: ctx.schoolId,
          forumId: forum.id,
          slug: c.slug,
          name: c.name,
          description: c.description,
          position: ci,
        },
      });
      categoryIds.set(`${f.slug}/${c.slug}`, category.id);
    }
  }

  let threads = 0;
  let posts = 0;

  for (const t of spec.threads) {
    const author = await memberOf(ctx, t.author);
    const forumId = forumIds.get(t.forum);
    if (!author || !forumId) continue;

    const created = await createThread({
      schoolId: ctx.schoolId,
      forumId,
      categoryId: t.category ? (categoryIds.get(`${t.forum}/${t.category}`) ?? null) : null,
      authorMembershipId: author.id,
      authorRole: author.role,
      title: t.title,
      body: t.body,
      actorUserId: author.userId,
      skipRateLimit: true,
    });
    if (!created.ok || !created.threadId) continue;
    threads += 1;
    posts += 1;

    for (const reply of t.replies ?? []) {
      const replier = await memberOf(ctx, reply.author);
      if (!replier) continue;
      const result = await createPost({
        schoolId: ctx.schoolId,
        threadId: created.threadId,
        authorMembershipId: replier.id,
        authorRole: replier.role,
        body: reply.body,
        actorUserId: replier.userId,
        skipRateLimit: true,
      });
      if (result.ok) posts += 1;
    }

    // Moderation states are applied through the real moderator path, so the
    // seed cannot produce a state the application would refuse to reach.
    const moderator =
      (await memberOf(ctx, 'registrar@geu.edu')) ??
      (await memberOf(ctx, 'registrar@meridian.edu.gh'));

    if (t.pin && moderator) {
      await moderateThread({
        schoolId: ctx.schoolId,
        threadId: created.threadId,
        action: 'PIN',
        moderatorMembershipId: moderator.id,
        moderatorRole: moderator.role,
        actorUserId: moderator.userId,
      });
    }
    if (t.lock && moderator) {
      await moderateThread({
        schoolId: ctx.schoolId,
        threadId: created.threadId,
        action: 'LOCK',
        moderatorMembershipId: moderator.id,
        moderatorRole: moderator.role,
        actorUserId: moderator.userId,
      });
    }
    if (t.report) {
      const reporter = await memberOf(ctx, t.report.by);
      if (reporter) {
        await reportContent({
          schoolId: ctx.schoolId,
          threadId: created.threadId,
          reporterMembershipId: reporter.id,
          reason: t.report.reason,
          detail: t.report.detail ?? null,
          actorUserId: reporter.userId,
        });
      }
    }
  }

  return { forums: spec.forums.length, threads, posts };
}

// -----------------------------------------------------------------------------
// Golden Eagles University
// -----------------------------------------------------------------------------

export const GEU_FORUMS: ForumSpec[] = [
  {
    slug: 'staff-room',
    name: 'Staff Room',
    description: 'For academic and administrative staff. Not visible to students.',
    audience: 'STAFF',
    categories: [
      { slug: 'teaching', name: 'Teaching & Assessment', description: 'Curriculum, marking, moderation.' },
      { slug: 'admin', name: 'Administration', description: 'Timetables, policy, committees.' },
    ],
  },
  {
    slug: 'commons',
    name: 'Student Commons',
    description: 'Open to every student and member of staff.',
    audience: 'STUDENT',
    categories: [
      { slug: 'academics', name: 'Academics', description: 'Courses, registration, study.' },
      { slug: 'campus', name: 'Campus Life', description: 'Societies, events, notices.' },
    ],
  },
];

export const GEU_THREADS: ThreadSpec[] = [
  {
    forum: 'commons',
    category: 'academics',
    author: 'registrar@geu.edu',
    title: 'Registration for Fall 2025 closes in three weeks',
    body: [
      'Registration closes at the end of the add/drop window. A few reminders:',
      '',
      '- Check your **outstanding balance** before you register — an unpaid invoice above the tolerance will block you.',
      '- The minimum load is 15 credits and the maximum is 24.',
      '- An overload above 24 needs a CGPA of 3.5 and the Registrar’s approval.',
      '',
      'Full detail is on the [registration page](/me/registration).',
    ].join('\n'),
    pin: true,
    replies: [
      {
        author: 'chidi.eze@student.geu.edu',
        body: 'Does a *partially paid* invoice count against the tolerance, or only the unpaid balance?',
      },
      {
        author: 'registrar@geu.edu',
        body: 'Only the outstanding balance. If you have paid down to within the tolerance you can register.',
      },
    ],
  },
  {
    forum: 'commons',
    category: 'academics',
    author: 'kunle.adeoye@student.geu.edu',
    title: 'How is the CGPA actually calculated when you repeat a course?',
    body: [
      'I repeated CSC201 and I am not sure which attempt counts.',
      '',
      'Does the old grade stay in the average, or is it replaced?',
    ].join('\n'),
    replies: [
      {
        author: 'a.okafor@geu.edu',
        body: [
          'The **best attempt** counts towards the CGPA, and the earlier attempt stays visible on your transcript as a matter of record.',
          '',
          'So the average improves, but the history is not rewritten. That is deliberate — a transcript that quietly erased a repeat would not be an accurate document.',
        ].join('\n'),
      },
      {
        author: 'kunle.adeoye@student.geu.edu',
        body: 'That makes sense, thank you.',
      },
    ],
  },
  {
    forum: 'commons',
    category: 'campus',
    author: 'segun.okonkwo@student.geu.edu',
    title: 'CHEAP ESSAYS — GUARANTEED FIRST CLASS — WHATSAPP NOW',
    body: 'Order your assignments here, fast delivery, no plagiarism check. Contact me for prices.',
    report: {
      by: 'chidi.eze@student.geu.edu',
      reason: 'ACADEMIC_DISHONESTY',
      detail: 'Advertising an essay mill on the student forum.',
    },
  },
  {
    forum: 'commons',
    category: 'campus',
    author: 'chidi.eze@student.geu.edu',
    title: 'Study group for MTH102 — Thursdays, library third floor',
    body: [
      'Starting a linear algebra study group. Everyone welcome, whatever your level.',
      '',
      '1. Thursdays, 6pm',
      '2. Library, third floor',
      '3. Bring the problem sheet',
      '',
      'cc @a.okafor@geu.edu in case the department wants to send a demonstrator.',
    ].join('\n'),
    replies: [
      { author: 'kunle.adeoye@student.geu.edu', body: 'I am in. Do we need to book the room?' },
    ],
  },
  {
    forum: 'staff-room',
    category: 'teaching',
    author: 'a.okafor@geu.edu',
    title: 'Marking moderation for the Fall gradesheets',
    body: [
      'A reminder on how the gradesheet behaves, since two people have asked.',
      '',
      '### What the system enforces',
      '',
      '- A section cannot be **posted** until every registered student is graded. Partial results are worse than none — a student with a blank cannot tell whether they failed, were missed, or are still being marked.',
      '- Continuous assessment is out of 40 and the examination out of 60.',
      '- Leaving both blank means *not assessed*, which is not the same as a zero.',
      '',
      '### What still needs a human',
      '',
      'Anything anomalous — a cohort average well outside the usual band, or a single mark far from the rest — should come to me before posting.',
      '',
      'The grade bands themselves are configurable per school now, so if you see a letter you do not expect, check `Settings → School` rather than assuming the arithmetic is wrong.',
    ].join('\n'),
    pin: true,
    replies: [
      {
        author: 'f.dauda@geu.edu',
        body: 'Noted. Mathematics will have both sections in by the end of next week.',
      },
      {
        author: 'e.balogun@geu.edu',
        body: 'One question — if we re-grade after a scale change, does the transcript update automatically?',
      },
      {
        author: 'a.okafor@geu.edu',
        body: [
          'Yes. The raw score is what is stored; the letter and the grade point are derived from whichever scale the school currently publishes.',
          '',
          'So a scale change re-derives everything rather than leaving old letters frozen against new rules.',
        ].join('\n'),
      },
    ],
  },
  {
    forum: 'staff-room',
    category: 'admin',
    author: 'registrar@geu.edu',
    title: 'Faculty board papers — deadline was Friday',
    body: 'Three departments have not submitted. Please get them to me today so the pack can go out.',
    lock: true,
    replies: [
      { author: 'f.dauda@geu.edu', body: 'Mathematics sent theirs on Thursday — check with the office.' },
    ],
  },
];

// -----------------------------------------------------------------------------
// Meridian Institute of Technology
// -----------------------------------------------------------------------------

export const MIT_FORUMS: ForumSpec[] = [
  {
    slug: 'staff-room',
    name: 'Faculty Room',
    description: 'Teaching staff and administration.',
    audience: 'STAFF',
    categories: [
      { slug: 'teaching', name: 'Teaching', description: 'Delivery, assessment and moderation.' },
    ],
  },
  {
    slug: 'commons',
    name: 'Student Commons',
    description: 'For Meridian students.',
    audience: 'STUDENT',
    categories: [
      { slug: 'academics', name: 'Academics', description: 'Courses and study.' },
    ],
  },
];

export const MIT_THREADS: ThreadSpec[] = [
  {
    forum: 'commons',
    category: 'academics',
    author: 'registrar@meridian.edu.gh',
    title: 'Meridian grades on a 5.0 scale — what that means for you',
    body: [
      'A few students have asked why their grade point looks different from a friend’s at another institution.',
      '',
      'Meridian publishes a **5.0** scale. A mark of 84 is an A worth 5.00 here; the same mark on a 4.0 scale is worth 4.00. Neither is wrong — they are different scales, and your transcript states which one applies.',
      '',
      'Your degree classification is calculated against the Meridian scale throughout.',
    ].join('\n'),
    pin: true,
    replies: [
      { author: 'ama.darko@student.meridian.edu.gh', body: 'Thanks — that clears up a lot.' },
    ],
  },
  {
    forum: 'staff-room',
    category: 'teaching',
    author: 'n.owusu@meridian.edu.gh',
    title: 'DAT201 capstone — brief for review',
    body: [
      'Draft brief for the machine-learning capstone. Comments welcome before I circulate it.',
      '',
      'The assessment split I have in mind:',
      '',
      '```',
      'model quality      40%',
      'written report     35%',
      'presentation       25%',
      '```',
      '',
      '@a.okafor@geu.edu — you are teaching this one, so your view matters most.',
    ].join('\n'),
    replies: [
      {
        author: 'a.okafor@geu.edu',
        body: [
          'The split looks right. I would only say that *model quality* needs a rubric of its own, or it becomes a leaderboard.',
          '',
          'Suggest weighting reproducibility inside that 40% — a well-documented model that scores slightly lower is the better piece of student work.',
        ].join('\n'),
      },
    ],
  },
];
