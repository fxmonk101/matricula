import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { requireTenantRole } from '@/server/tenant-context';
import { can } from '@/lib/auth/rbac';
import { mayAuthorOffering } from '@/server/services/lms.service';
import {
  loadGradebook,
  previewCourseworkPost,
} from '@/server/services/coursework.service';
import { markPercentage } from '@/lib/domain/gradebook';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  StatTile,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { PostPanel } from './post-panel';

export const metadata: Metadata = { title: 'Coursework' };

/**
 * Every piece of coursework on a section, every student, and the control that
 * moves the marks onto the academic record.
 *
 * The grid is the point: a lecturer wants to see, in one look, who has not
 * submitted and what they have not marked. Both are absences, and a table built
 * only from the rows that exist would show neither.
 */
export default async function CourseworkOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { db, schoolId, session, role } = await requireTenantRole(
    'INSTRUCTOR',
    'HOD',
    'DEAN',
    'ADMIN',
    'REGISTRAR',
  );
  const { id: offeringId } = await params;

  const offering = await db.courseOffering.findUnique({
    where: { id: offeringId },
    include: { course: true, term: true },
  });
  if (!offering) notFound();

  const mayAuthor = await mayAuthorOffering({
    schoolId,
    offeringId,
    instructorProfileId: session.pid,
    role,
  });
  if (!mayAuthor) redirect('/forbidden');

  const [{ coursework, rows }, preview] = await Promise.all([
    loadGradebook({ schoolId, offeringId }),
    // Previewed with the lenient reading, which is what the panel's unticked
    // boxes mean. Ticking one recomputes on the server at post time.
    previewCourseworkPost({ schoolId, offeringId, countMissingAsZero: false }),
  ]);

  const totalPoints = coursework.reduce((sum, c) => sum + c.pointsPossible, 0);
  const unmarked = rows.reduce(
    (sum, row) => sum + row.items.filter((i) => i.submitted && i.score === null).length,
    0,
  );

  return (
    <>
      <PageHeader
        title="Coursework"
        description={`${offering.course.code} ${offering.section} · ${offering.term.name}`}
        actions={
          <div className="flex items-center gap-3">
            <Link
              href={`/teaching/${offeringId}/modules`}
              className="text-xs font-medium text-brand-700 hover:underline"
            >
              Course content →
            </Link>
            <Link
              href={`/teaching/${offeringId}`}
              className="text-xs font-medium text-brand-700 hover:underline"
            >
              Gradesheet →
            </Link>
          </div>
        }
      />

      {coursework.length === 0 ? (
        <Card>
          <EmptyState
            title="No coursework set yet"
            description="Add an assignment to a module, and it appears here with everybody's hand-ins."
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Pieces of work" value={coursework.length} sublabel={`${totalPoints} marks in total`} />
            <StatTile label="Students" value={rows.length} />
            <StatTile
              label="Awaiting a mark"
              value={unmarked}
              tone={unmarked > 0 ? 'warning' : 'success'}
            />
            <StatTile
              label="Ready to post"
              value={preview.summary.toSet}
              tone={preview.summary.toSet > 0 ? 'brand' : 'neutral'}
              sublabel={`CA is out of ${preview.caWeight}`}
            />
          </div>

          {unmarked > 0 && (
            <Alert tone="info" title={`${unmarked} submissions are waiting to be marked`} className="mt-4">
              Unmarked work is left out of the CA calculation rather than counted as zero, so a
              student is never penalised for a marking backlog.
            </Alert>
          )}

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Card>
                <CardHeader
                  title="Marks"
                  description="A dash means nothing was handed in. A blank means it has not been marked."
                />
                <div className="overflow-x-auto">
                  <Table className="table-zebra">
                    <thead>
                      <tr>
                        <Th>Student</Th>
                        {coursework.map((piece) => (
                          <Th key={piece.id} className="whitespace-nowrap">
                            <Link
                              href={`/teaching/${offeringId}/coursework/${piece.id}`}
                              className="text-brand-700 hover:underline"
                            >
                              {piece.title}
                            </Link>
                            <span className="block text-[10px] font-normal text-slate-400">
                              /{piece.pointsPossible}
                            </span>
                          </Th>
                        ))}
                        <Th className="whitespace-nowrap">CA</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rows.map((row) => {
                        const computed = preview.rows.find(
                          (p) => p.enrollmentId === row.enrollmentId,
                        );
                        return (
                          <tr key={row.enrollmentId}>
                            <Td className="whitespace-nowrap text-xs">
                              <span className="font-medium text-slate-900">{row.studentName}</span>
                              <span className="block text-[11px] text-slate-500">
                                {row.matricNumber}
                              </span>
                            </Td>

                            {row.items.map((item) => (
                              <Td
                                key={item.courseworkId}
                                className="whitespace-nowrap text-xs tabular-nums"
                              >
                                {item.score !== null ? (
                                  <span className="text-slate-900">
                                    {item.score}
                                    <span className="ml-1 text-[10px] text-slate-400">
                                      {markPercentage(item.score, item.pointsPossible)}%
                                    </span>
                                  </span>
                                ) : item.submitted ? (
                                  <Badge tone="info">to mark</Badge>
                                ) : (
                                  <span className="text-slate-300">—</span>
                                )}
                              </Td>
                            ))}

                            <Td className="whitespace-nowrap text-xs tabular-nums">
                              {computed?.computed.caScore !== null &&
                              computed?.computed.caScore !== undefined ? (
                                <span className="font-medium text-slate-900">
                                  {computed.computed.caScore}
                                </span>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                              {computed?.outcome === 'WOULD_OVERWRITE' && (
                                <Badge tone="warning" className="ml-1">
                                  by hand: {computed.existingCaScore}
                                </Badge>
                              )}
                            </Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </div>
              </Card>
            </div>

            <div>
              <PostPanel
                offeringId={offeringId}
                counts={{ ...preview.summary, caWeight: preview.caWeight }}
                mayPost={can(role, 'grade:submit')}
              />
            </div>
          </div>
        </>
      )}
    </>
  );
}
