import type { Metadata } from 'next';
import Link from 'next/link';

import { requireTenantRole } from '@/server/tenant-context';
import { titleCase } from '@/lib/utils';
import { like } from '@/lib/search-filter';
import {
  Badge,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Table,
  Td,
  Th,
  toneForStatus,
} from '@/components/ui';
import { can } from '@/lib/auth/rbac';

export const metadata: Metadata = { title: 'Students' };

const PAGE_SIZE = 25;

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; program?: string; standing?: string; page?: string }>;
}) {
  const { db, school, schoolId, role } = await requireTenantRole('ADMIN', 'REGISTRAR', 'ADMISSIONS', 'FINANCE', 'INSTRUCTOR');

  const params = await searchParams;
  const q = params.q?.trim() ?? '';
  const page = Math.max(1, Number(params.page) || 1);

  /*
   * Filters are composed into a single `where` rather than fetching everything
   * and filtering in JS. At a few hundred students the difference is invisible;
   * at forty thousand it is the difference between a page that loads and one
   * that times out. Pushing predicates to the database is the default.
   */
  const where = {
    ...(params.program ? { programId: params.program } : {}),
    ...(params.standing ? { academicStanding: params.standing } : {}),
    ...(q
      ? {
          OR: [
            { matricNumber: like(q) },
            { user: { firstName: like(q) } },
            { user: { lastName: like(q) } },
            { user: { email: like(q) } },
          ],
        }
      : {}),
  };

  const [students, total, programs] = await Promise.all([
    db.student.findMany({
      where,
      include: {
        user: true,
        program: { select: { code: true, name: true } },
        _count: { select: { holds: { where: { releasedAt: null } } } },
      },
      orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.student.count({ where }),
    db.program.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="Student register"
        description={`${total.toLocaleString()} record${total === 1 ? '' : 's'} matching the current filter.`}
        actions={
          can(role, 'student:register') ? (
            <Link
              href="/students/register"
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-onAccent transition-colors hover:bg-brand-700"
            >
              Register a student
            </Link>
          ) : null
        }
      />

      <Card>
        {/* A plain GET form: filters land in the URL, so a filtered view is
            shareable, bookmarkable, and survives a refresh. */}
        <form className="flex flex-wrap items-end gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-56 flex-1">
            <label htmlFor="q" className="mb-1.5 block text-xs font-medium text-slate-700">
              Search
            </label>
            <Input id="q" name="q" defaultValue={q} placeholder="Name, matric number or email" />
          </div>

          <div className="w-48">
            <label htmlFor="program" className="mb-1.5 block text-xs font-medium text-slate-700">
              Program
            </label>
            <Select id="program" name="program" defaultValue={params.program ?? ''}>
              <option value="">All programs</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code}
                </option>
              ))}
            </Select>
          </div>

          <div className="w-44">
            <label htmlFor="standing" className="mb-1.5 block text-xs font-medium text-slate-700">
              Standing
            </label>
            <Select id="standing" name="standing" defaultValue={params.standing ?? ''}>
              <option value="">Any standing</option>
              {['GOOD', 'DEANS_LIST', 'WARNING', 'PROBATION', 'DISMISSED'].map((s) => (
                <option key={s} value={s}>
                  {titleCase(s)}
                </option>
              ))}
            </Select>
          </div>

          <button
            type="submit"
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-onAccent hover:bg-brand-700"
          >
            Apply
          </button>
          {(q || params.program || params.standing) && (
            <Link href="/students" className="px-2 py-2 text-sm text-slate-600 hover:underline">
              Clear
            </Link>
          )}
        </form>

        {students.length === 0 ? (
          <EmptyState
            title="No students match this filter"
            description="Try broadening the search, or clear the filters to see the full register."
          />
        ) : (
          <>
            <Table className="table-hover">
              <thead>
                <tr>
                  <Th>Student</Th>
                  <Th>Matric number</Th>
                  <Th>Program</Th>
                  <Th className="text-center">Level</Th>
                  <Th className="text-right">CGPA</Th>
                  <Th className="text-right">Credits</Th>
                  <Th>Standing</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {students.map((s) => (
                  <tr key={s.id}>
                    <Td>
                      <div className="font-medium text-slate-900">
                        {s.user.firstName} {s.user.lastName}
                      </div>
                      <div className="text-xs text-slate-500">{s.user.email}</div>
                    </Td>
                    <Td className="font-mono text-xs">{s.matricNumber}</Td>
                    <Td className="text-xs">{s.program.code}</Td>
                    <Td className="text-center tabular-nums">{s.level}</Td>
                    <Td className="text-right font-medium tabular-nums">{s.cgpa.toFixed(2)}</Td>
                    <Td className="text-right tabular-nums text-xs">
                      {s.creditsEarned}/{s.creditsAttempted}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <Badge tone={toneForStatus(s.academicStanding)}>
                          {titleCase(s.academicStanding)}
                        </Badge>
                        {s._count.holds > 0 ? (
                          <Badge tone="danger" title="Active holds on this record">
                            {s._count.holds} hold{s._count.holds === 1 ? '' : 's'}
                          </Badge>
                        ) : null}
                      </div>
                    </Td>
                    <Td className="text-right">
                      <Link
                        href={`/students/${s.id}`}
                        className="text-xs font-medium text-brand-700 hover:underline"
                      >
                        Open
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>

            {pageCount > 1 ? (
              <Pagination page={page} pageCount={pageCount} params={params} />
            ) : null}
          </>
        )}
      </Card>
    </>
  );
}

function Pagination({
  page,
  pageCount,
  params,
}: {
  page: number;
  pageCount: number;
  params: Record<string, string | undefined>;
}) {
  const href = (n: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v && k !== 'page') sp.set(k, v);
    }
    sp.set('page', String(n));
    return `/students?${sp.toString()}`;
  };

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between border-t border-slate-200 px-5 py-3 text-xs"
    >
      <span className="text-slate-500">
        Page {page} of {pageCount}
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className="rounded-md px-2.5 py-1.5 text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
            Previous
          </Link>
        ) : null}
        {page < pageCount ? (
          <Link href={href(page + 1)} className="rounded-md px-2.5 py-1.5 text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
            Next
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
