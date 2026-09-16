import type { Metadata } from 'next';

import { requireTenantRole } from '@/server/tenant-context';
import { listTerms, reconcileCurrentTerm } from '@/server/services/term.service';
import { listFeeStructures } from '@/server/services/fees.service';
import { loadSchoolConfig } from '@/server/school-config';
import { dbFor } from '@/lib/tenant';
import { can } from '@/lib/auth/rbac';
import { formatMoney } from '@/lib/domain/money';
import { formatDate } from '@/lib/utils';
import { LEVELS } from '@/lib/domain/structure';
import {
  SEASON_LABELS,
  isInSession,
  registrationState,
  type Season,
} from '@/lib/domain/term';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { DialogTrigger } from '@/components/ui/overlays';
import { TermActions, TermDialog } from './term-dialog';
import { FeeStructureActions, FeeStructureDialog } from './fee-dialog';

export const metadata: Metadata = { title: 'Calendar and fees' };

/**
 * The academic calendar, and what each term costs.
 *
 * Two offices on one page because they are inseparable in practice: a fee
 * schedule belongs to a term, and a term with no schedule cannot raise an
 * invoice. Splitting them would mean a bursar navigating away to find out
 * which terms exist.
 */
export default async function CalendarPage() {
  const { schoolId, role, school } = await requireTenantRole('ADMIN', 'REGISTRAR', 'FINANCE');

  /*
   * Repair before reading.
   *
   * "Only one term per school may be current" was documented in the schema and
   * enforced nowhere for several phases, so existing data can violate it. A
   * page that renders two current terms is a page that disagrees with every
   * other screen about where a mark belongs, so it is fixed here and the fix
   * is reported rather than done silently.
   */
  const repair = await reconcileCurrentTerm(schoolId);

  const [terms, structures, config, programmes] = await Promise.all([
    listTerms(schoolId),
    listFeeStructures(schoolId),
    loadSchoolConfig(schoolId),
    dbFor(schoolId).program.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    }),
  ]);

  const mayEditTerms = can(role, 'term:write');
  const mayEditFees = can(role, 'fee:configure');
  const currency = config.finance.currency;
  const now = new Date();

  const termOptions = terms.map((t) => ({
    id: t.id,
    code: t.code,
    name: t.name,
    isCurrent: t.isCurrent,
  }));

  return (
    <>
      <PageHeader
        title="Calendar and fees"
        description={`The academic terms ${school.shortName} runs on, and what each one costs. Everything with a date — registration, marks, invoices — belongs to a term.`}
      />

      {repair.repaired && (
        <Alert tone="warning" title="More than one term was marked current" className="mb-4">
          {repair.cleared.join(', ')} {repair.cleared.length === 1 ? 'was' : 'were'} cleared, and{' '}
          {repair.kept} kept as the current term. Two current terms make different screens disagree
          about which term a mark or an invoice belongs to.
        </Alert>
      )}

      {terms.length === 0 && (
        <Alert tone="info" title="Start with a term" className="mb-4">
          Nothing in the system can be dated until one exists — no sections, no registration, no
          invoices. Create the term you are teaching now.
        </Alert>
      )}

      {/* ------------------------------------------------------------- terms */}
      <Card className="mb-4">
        <CardHeader
          title="Academic terms"
          description="Only one term is current at a time. That is the one new marks and invoices attach to."
          actions={
            mayEditTerms ? (
              <TermDialog
                isFirstTerm={terms.length === 0}
                trigger={
                  <DialogTrigger asChild>
                    <Button size="sm">New term</Button>
                  </DialogTrigger>
                }
              />
            ) : null
          }
        />

        {terms.length === 0 ? (
          <EmptyState
            title="No terms yet"
            description="A term is the calendar everything else hangs a date off."
          />
        ) : (
          <Table className="table-hover">
            <thead>
              <tr>
                <Th>Term</Th>
                <Th>Session</Th>
                <Th>Runs</Th>
                <Th>Registration</Th>
                <Th>In use</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {terms.map((term) => {
                const reg = registrationState(term, now);
                const running = isInSession(term, now);
                const used =
                  term._count.offerings +
                  term._count.invoices +
                  term._count.feeStructures +
                  term._count.applications;

                return (
                  <tr key={term.id}>
                    <Td>
                      <div className="flex items-center gap-2">
                        <code className="font-mono text-xs font-semibold text-brand-700">
                          {term.code}
                        </code>
                        {term.isCurrent && <Badge tone="brand">Current</Badge>}
                        {running && !term.isCurrent && <Badge tone="info">In session</Badge>}
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500">{term.name}</div>
                    </Td>
                    <Td className="text-xs text-slate-600">
                      {term.academicYear}
                      <div className="text-[11px] text-slate-400">
                        {SEASON_LABELS[term.season as Season] ?? term.season}
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-slate-600">
                      {formatDate(term.startDate)}
                      <div className="text-[11px] text-slate-400">
                        to {formatDate(term.endDate)}
                      </div>
                    </Td>
                    <Td>
                      <Badge
                        tone={reg === 'OPEN' ? 'success' : reg === 'BEFORE' ? 'neutral' : 'warning'}
                      >
                        {reg === 'OPEN' ? 'Open' : reg === 'BEFORE' ? 'Not yet' : 'Closed'}
                      </Badge>
                      <div className="mt-0.5 text-[11px] text-slate-400">
                        {formatDate(term.registrationOpensAt)} –{' '}
                        {formatDate(term.registrationClosesAt)}
                      </div>
                    </Td>
                    <Td className="text-[11px] text-slate-500">
                      {used === 0 ? (
                        <span className="text-slate-400">nothing yet</span>
                      ) : (
                        <>
                          {term._count.offerings} sections
                          <div>{term._count.invoices} invoices</div>
                        </>
                      )}
                    </Td>
                    <Td className="text-right">
                      {mayEditTerms && (
                        <TermActions
                          term={{
                            id: term.id,
                            code: term.code,
                            name: term.name,
                            academicYear: term.academicYear,
                            season: term.season,
                            startDate: term.startDate.toISOString(),
                            endDate: term.endDate.toISOString(),
                            registrationOpensAt: term.registrationOpensAt.toISOString(),
                            registrationClosesAt: term.registrationClosesAt.toISOString(),
                            addDropDeadline: term.addDropDeadline.toISOString(),
                            withdrawalDeadline: term.withdrawalDeadline.toISOString(),
                            isCurrent: term.isCurrent,
                            offeringCount: term._count.offerings,
                            invoiceCount: term._count.invoices,
                            feeStructureCount: term._count.feeStructures,
                            applicationCount: term._count.applications,
                          }}
                        />
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {/* -------------------------------------------------------------- fees */}
      <Card>
        <CardHeader
          title="Fee schedules"
          description="The most specific match wins: a schedule for one programme and level beats one for the whole institution."
          actions={
            mayEditFees && terms.length > 0 ? (
              <FeeStructureDialog
                terms={termOptions}
                programmes={programmes}
                levels={[...LEVELS]}
                currencySymbol={currency.symbol}
                trigger={
                  <DialogTrigger asChild>
                    <Button size="sm">New fee schedule</Button>
                  </DialogTrigger>
                }
              />
            ) : null
          }
        />

        {terms.length === 0 ? (
          <EmptyState
            title="Not yet"
            description="A fee schedule belongs to a term, so create a term first."
          />
        ) : structures.length === 0 ? (
          <EmptyState
            title="No fee schedules yet"
            description="Without one, an invoice raised for a student comes to nothing."
          />
        ) : (
          <Table className="table-hover">
            <thead>
              <tr>
                <Th>Schedule</Th>
                <Th>Term</Th>
                <Th>Applies to</Th>
                <Th className="w-28">Lines</Th>
                <Th className="w-36">Total</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {structures.map((s) => {
                const total = s.items.reduce((sum, i) => sum + i.amountMinor, 0);
                const perCredit = s.items.filter((i) => i.perCreditHour).length;

                return (
                  <tr key={s.id} className={s.isActive ? undefined : 'opacity-55'}>
                    <Td>
                      <div className="text-sm text-slate-900">{s.name}</div>
                      {!s.isActive && (
                        <div className="text-[11px] text-slate-500">withdrawn</div>
                      )}
                    </Td>
                    <Td>
                      <code className="font-mono text-xs text-brand-700">{s.term.code}</code>
                      {s.term.isCurrent && (
                        <div>
                          <Badge tone="brand">Current</Badge>
                        </div>
                      )}
                    </Td>
                    <Td className="text-xs text-slate-600">
                      {s.program ? s.program.code : 'Every programme'}
                      <div className="text-[11px] text-slate-400">
                        {s.level ? `Level ${s.level}` : 'Every level'}
                      </div>
                    </Td>
                    <Td className="text-xs tabular-nums text-slate-600">
                      {s.items.length}
                      {perCredit > 0 && (
                        <div className="text-[11px] text-slate-400">{perCredit} per credit</div>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-xs tabular-nums text-slate-900">
                      {formatMoney(total, { currency })}
                      {perCredit > 0 && (
                        <div className="text-[11px] text-slate-400">plus credit charges</div>
                      )}
                    </Td>
                    <Td className="text-right">
                      {mayEditFees && (
                        <FeeStructureActions
                          structure={{
                            id: s.id,
                            name: s.name,
                            termId: s.termId,
                            termCode: s.term.code,
                            programId: s.programId,
                            programCode: s.program?.code ?? null,
                            level: s.level,
                            isActive: s.isActive,
                            totalMinor: total,
                            items: s.items.map((i) => ({
                              code: i.code,
                              description: i.description,
                              amount: String(i.amountMinor / 10 ** currency.exponent),
                              perCreditHour: i.perCreditHour,
                              isMandatory: i.isMandatory,
                            })),
                          }}
                          terms={termOptions}
                          programmes={programmes}
                          levels={[...LEVELS]}
                          currencySymbol={currency.symbol}
                        />
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
