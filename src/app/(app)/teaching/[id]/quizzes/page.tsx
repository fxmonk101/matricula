import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { requireTenantRole } from '@/server/tenant-context';
import { mayAuthorOffering } from '@/server/services/lms.service';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Table,
  Td,
  Th,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Quizzes' };

/**
 * Every quiz on a section.
 *
 * Shows how many have sat each one and how many need a person to look — which
 * is the only thing on this page a lecturer has to act on, and so is the thing
 * that gets a colour.
 */
export default async function QuizzesPage({
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

  const items = await db.moduleItem.findMany({
    where: { kind: 'QUIZ', module: { space: { offeringId } } },
    include: {
      module: { select: { title: true } },
      coursework: {
        include: {
          quiz: {
            select: {
              timeLimitMinutes: true,
              maxAttempts: true,
              _count: { select: { questions: true, attempts: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const needingReview = await db.quizAttempt.count({
    where: { needsReview: true, submittedAt: { not: null }, quiz: { coursework: { moduleItem: { module: { space: { offeringId } } } } } },
  });

  return (
    <>
      <PageHeader
        title="Quizzes"
        description={`${offering.course.code}${offering.section ? ` ${offering.section}` : ''} · ${offering.term.name}`}
        actions={
          <div className="flex items-center gap-3">
            <Link
              href={`/teaching/${offeringId}/quizzes/new`}
              className="text-xs font-medium text-brand-700 hover:underline"
            >
              New quiz →
            </Link>
            <Link
              href={`/teaching/${offeringId}/modules`}
              className="text-xs font-medium text-brand-700 hover:underline"
            >
              Course content →
            </Link>
          </div>
        }
      />

      {needingReview > 0 && (
        <Card className="mb-4">
          <CardHeader
            title={`${needingReview} ${needingReview === 1 ? 'paper needs' : 'papers need'} a look`}
            description="A typed answer did not exactly match what was expected. Those are marked zero until you decide otherwise."
          />
        </Card>
      )}

      {items.length === 0 ? (
        <Card>
          <EmptyState
            title="No quizzes yet"
            description="A quiz is a piece of coursework that marks itself. Its marks roll into continuous assessment exactly like an assignment's."
          />
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <Table className="table-zebra">
              <thead>
                <tr>
                  <Th>Quiz</Th>
                  <Th className="whitespace-nowrap">Module</Th>
                  <Th className="whitespace-nowrap">Questions</Th>
                  <Th className="whitespace-nowrap">Marks</Th>
                  <Th className="whitespace-nowrap">Time</Th>
                  <Th className="whitespace-nowrap">Sat</Th>
                  <Th>State</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => (
                  <tr key={item.id}>
                    <Td className="whitespace-nowrap text-xs">
                      <Link
                        href={`/teaching/${offeringId}/quizzes/${item.id}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {item.title}
                      </Link>
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-slate-500">{item.module.title}</Td>
                    <Td className="text-xs tabular-nums">{item.coursework?.quiz?._count.questions ?? 0}</Td>
                    <Td className="text-xs tabular-nums">{item.coursework?.pointsPossible ?? 0}</Td>
                    <Td className="whitespace-nowrap text-xs text-slate-600">
                      {item.coursework?.quiz?.timeLimitMinutes
                        ? `${item.coursework.quiz.timeLimitMinutes} min`
                        : 'Untimed'}
                    </Td>
                    <Td className="text-xs tabular-nums">{item.coursework?.quiz?._count.attempts ?? 0}</Td>
                    <Td>
                      <Badge tone={item.isPublished ? 'success' : 'neutral'}>
                        {item.isPublished ? 'Published' : 'Draft'}
                      </Badge>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>
      )}
    </>
  );
}
