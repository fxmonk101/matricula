import type { Metadata } from 'next';
import Link from 'next/link';

import { STAGE_LABELS, type ResultStage } from '@/lib/domain/result-workflow';
import { requireTenantRole } from '@/server/tenant-context';
import { sheetsAwaiting } from '@/server/services/result-workflow.service';
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
import { DecisionPanel } from './decision-panel';

export const metadata: Metadata = { title: 'Results for approval' };

/**
 * The approval queue.
 *
 * What an office sees is decided by their ROLE, not by a filter they choose:
 * `sheetsAwaiting` returns only the stages that role may act on, so a dean
 * cannot see — let alone approve — something still sitting with a head of
 * department. Showing everything and disabling the buttons would leak a
 * department's marks to the whole faculty before its HOD had looked at them.
 */
export default async function ResultsPage() {
  const { role, schoolId, config, school } = await requireTenantRole(
    'OWNER',
    'ADMIN',
    'REGISTRAR',
    'DEAN',
    'HOD',
  );

  const queue = await sheetsAwaiting({ schoolId, role });

  const chain = [
    config.resultWorkflow.requireHod && 'head of department',
    config.resultWorkflow.requireFaculty && 'faculty board',
    config.resultWorkflow.requireSenate && 'Senate',
  ].filter(Boolean) as string[];

  return (
    <>
      <PageHeader
        title="Results for approval"
        description={
          chain.length > 0
            ? `At ${school.shortName}, results pass the ${chain.join(', then the ')} before students see them.`
            : `${school.shortName} releases results as soon as a lecturer submits them.`
        }
      />

      {chain.length === 0 && (
        <Alert tone="warning" title="No approval is being required" className="mb-4">
          Results go straight to students the moment a lecturer submits them. A school officer can
          turn the chain on in the school settings.
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Waiting on you"
          value={queue.length}
          tone={queue.length > 0 ? 'brand' : 'success'}
        />
        <StatTile
          label="Students affected"
          value={queue.reduce((sum, s) => sum + s.students, 0)}
        />
        <StatTile label="Your part of the chain" value={stageNameFor(role)} />
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Waiting on you"
          description="Oldest first — a sheet that has sat for a week is a cohort that cannot see its results."
        />
        {queue.length === 0 ? (
          <EmptyState
            title="Nothing waiting"
            description="Sheets appear here when the office before you has passed them on."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Course</Th>
                  <Th className="whitespace-nowrap">Lecturer</Th>
                  <Th className="whitespace-nowrap">Students</Th>
                  <Th className="whitespace-nowrap">Waiting since</Th>
                  <Th>Decision</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {queue.map((sheet) => (
                  <tr key={sheet.offeringId}>
                    <Td className="whitespace-nowrap text-xs">
                      <Link
                        href={`/teaching/${sheet.offeringId}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {sheet.code}
                        {sheet.section ? ` ${sheet.section}` : ''}
                      </Link>
                      <span className="block text-[11px] text-slate-500">
                        {sheet.title} · {sheet.term}
                      </span>
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-slate-600">
                      {sheet.lecturer ?? '—'}
                    </Td>
                    <Td className="text-xs tabular-nums">{sheet.students}</Td>
                    <Td className="whitespace-nowrap text-[11px] text-slate-500">
                      {sheet.waitingSince.toISOString().slice(0, 10)}
                    </Td>
                    <Td>
                      <DecisionPanel offeringId={sheet.offeringId} code={sheet.code} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader title="How the chain works" />
        <div className="space-y-2 px-5 pb-5 text-xs leading-relaxed text-slate-600">
          <p>
            A mark a lecturer types is <strong>not</strong> on a student&rsquo;s record. It sits on
            the gradesheet until the chain is complete, and only then does it reach the transcript
            and count towards a CGPA.
          </p>
          <p>
            <strong>Sending a sheet back requires a reason.</strong> The lecturer is told what to
            change, and both the return and the reason stay on the record — so months later it is
            possible to answer what was queried, by whom, and when.
          </p>
          <p>
            Administrators cannot approve. The chain exists so that no single account can turn a
            mark into a degree classification.
          </p>
        </div>
      </Card>
    </>
  );
}

function stageNameFor(role: string): string {
  const stage: Record<string, ResultStage> = {
    HOD: 'HOD_REVIEW',
    DEAN: 'FACULTY_REVIEW',
    REGISTRAR: 'SENATE_REVIEW',
  };
  const mine = stage[role];
  if (!mine) return 'Oversight only';
  return STAGE_LABELS[mine].replace(/^With the |^With /, '');
}
