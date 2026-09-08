import 'server-only';

import { cache } from 'react';
import { notFound } from 'next/navigation';

import { requireTenantRole } from '@/server/tenant-context';

/**
 * =============================================================================
 * GUARDIAN ACCESS
 * =============================================================================
 *
 * The GUARDIAN role grants the SHAPE of the access — "may read a pupil's
 * academic record" — and the guardian/pupil link grants the SUBJECT. Holding
 * the role is never sufficient: every guardian route resolves the child list
 * from the signed-in user and then checks that the requested pupil is on it.
 *
 * The check lives here, once, rather than in each page. A guardian portal that
 * re-implements its authorisation per route will eventually get one of them
 * wrong, and the failure mode is a parent reading another family's child.
 */

export interface GuardianChild {
  studentId: string;
  name: string;
  admissionNo: string;
  relationship: string;
  isPrimary: boolean;
  canViewFinance: boolean;
  formClassName: string | null;
  yearGroupName: string | null;
}

/** The signed-in guardian's children, cached per request. */
export const getGuardianChildren = cache(async (): Promise<GuardianChild[]> => {
  const { db, session } = await requireTenantRole('GUARDIAN');

  const guardian = await db.guardian.findFirst({
    where: { userId: session.sub },
    include: {
      children: {
        include: {
          student: {
            include: {
              user: true,
              classEnrolments: {
                include: { formClass: { include: { yearGroup: true } }, term: true },
                orderBy: { term: { startDate: 'desc' } },
                take: 1,
              },
            },
          },
        },
      },
    },
  });

  // No guardian record is not an error — a membership can exist before the
  // office has linked any children to it. An empty list renders as "no children
  // linked yet", which is the honest answer.
  if (!guardian) return [];

  return guardian.children.map((link) => {
    const current = link.student.classEnrolments[0];
    return {
      studentId: link.studentId,
      name: `${link.student.user.firstName} ${link.student.user.lastName}`,
      admissionNo: link.student.matricNumber,
      relationship: link.relationship,
      isPrimary: link.isPrimary,
      canViewFinance: link.canViewFinance,
      formClassName: current?.formClass.name ?? null,
      yearGroupName: current?.formClass.yearGroup.name ?? null,
    };
  });
});

/**
 * The requested child, or a 404.
 *
 * 404 rather than 403 on purpose: a guardian asking after a pupil who is not
 * theirs should not learn from the response that the pupil exists.
 */
export async function requireGuardianChild(studentId: string): Promise<GuardianChild> {
  const children = await getGuardianChildren();
  const child = children.find((c) => c.studentId === studentId);
  if (!child) notFound();
  return child;
}
