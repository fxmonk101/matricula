import type { Metadata } from 'next';
import Link from 'next/link';

import { requireRoute } from '@/server/tenant-context';
import { subjectsForPupil } from '@/server/services/k12-lms.service';
import { Badge, Card, CardBody, EmptyState, PageHeader } from '@/components/ui';

export const metadata: Metadata = { title: 'My subjects' };

/**
 * A pupil's subjects for the current term.
 *
 * The K-12 counterpart of /me/courses. A pupil does not register for subjects —
 * they are in a form class and the class has subjects — so this is a reading of
 * their class's timetable rather than a list of anything they chose.
 */
export default async function MySubjectsPage() {
  const { schoolId, session, school } = await requireRoute('/me/subjects');

  const result = session.pid
    ? await subjectsForPupil({ schoolId, studentProfileId: session.pid })
    : { formClass: null, subjects: [] };

  return (
    <>
      <PageHeader
        title="My subjects"
        description={
          result.formClass
            ? `${result.formClass} · ${school.shortName}`
            : 'You are not in a form class this term.'
        }
      />

      {result.subjects.length === 0 ? (
        <Card>
          <EmptyState
            title={result.formClass ? 'No subjects yet' : 'No form class this term'}
            description={
              result.formClass
                ? 'Your teachers have not put anything here yet. It will appear as they do.'
                : 'The school office places pupils in a form class at the start of each term.'
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {result.subjects.map((subject) => (
            <Card key={subject.subjectAssignmentId}>
              <CardBody>
                <Link
                  href={`/me/subjects/${subject.subjectAssignmentId}`}
                  className="block text-sm font-semibold text-brand-700 hover:underline"
                >
                  {subject.name}
                </Link>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {subject.code}
                  {subject.teacher ? ` · ${subject.teacher}` : ''}
                </p>
                <div className="mt-3">
                  {subject.items === 0 ? (
                    <Badge tone="neutral">Nothing yet</Badge>
                  ) : (
                    <Badge tone="success">
                      {subject.items} {subject.items === 1 ? 'item' : 'items'}
                    </Badge>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
