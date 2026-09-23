'use client';

import { useActionState, useMemo, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  templateHeaders,
  type ImportKind,
  type PlannedRow,
} from '@/lib/domain/import';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  StatTile,
  Table,
  Td,
  Th,
} from '@/components/ui';
import {
  previewImportAction,
  runImportAction,
  type ImportFormState,
} from './actions';

/**
 * Importing a spreadsheet, in two steps that cannot be collapsed into one.
 *
 * STEP ONE SHOWS WHAT WOULD HAPPEN. Two thousand accounts created from a file
 * with the wrong column order is not something you fix by editing a row: every
 * one carries a one-time password somebody has to hand out, and undoing it
 * means deleting people who may already have signed in. So the counts, a
 * sample, and every problem are on screen before the button that writes exists.
 *
 * The file is held here in the browser and posted again to confirm, because the
 * server re-plans from the file rather than trusting a plan posted back to it.
 */

const OUTCOME_TONE: Record<PlannedRow['outcome'], 'success' | 'neutral' | 'danger'> = {
  CREATE: 'success',
  SKIP_EXISTING: 'neutral',
  REJECT: 'danger',
};

const OUTCOME_LABEL: Record<PlannedRow['outcome'], string> = {
  CREATE: 'New',
  SKIP_EXISTING: 'Already here',
  REJECT: 'Rejected',
};

function SubmitButton({ children }: { children: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Working…' : children}
    </Button>
  );
}

export function ImportPanel() {
  const [kind, setKind] = useState<ImportKind>('STUDENT');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const [preview, previewAction] = useActionState<ImportFormState, FormData>(
    previewImportAction,
    {},
  );
  const [run, runAction] = useActionState<ImportFormState, FormData>(runImportAction, {});

  const plan = preview.plan;
  const result = run.result;

  async function onFile(file: File | null) {
    if (!file) return;
    setFileName(file.name);
    // Read in the browser: the preview needs the text, and reading it here
    // means an obviously-wrong file never leaves the machine.
    setText(await file.text());
  }

  const sample = useMemo(() => {
    if (!plan) return [];
    // Problems first — they are what somebody needs to look at.
    return [...plan.rows]
      .sort((a, b) => {
        const rank = (r: PlannedRow) => (r.outcome === 'REJECT' ? 0 : r.outcome === 'SKIP_EXISTING' ? 1 : 2);
        return rank(a) - rank(b) || a.line - b.line;
      })
      .slice(0, 50);
  }, [plan]);

  function downloadTemplate() {
    const headers = templateHeaders(kind).join(',');
    const example =
      kind === 'STUDENT'
        ? 'Ada,Okafor,ada@example.edu,,08030000000,GEU/CSC/2026/001,BSC-CSC,100,2004-07-03,F'
        : 'Obi,Nwosu,obi@example.edu,,08030000000,Lecturer,Senior Lecturer,CSC';
    const blob = `${headers}\n${example}\n`;
    // A data: URI rather than a fetch — this is generated here and there is
    // nothing for the server to do.
    const link = document.createElement('a');
    link.href = `data:text/csv;charset=utf-8,${encodeURIComponent(blob)}`;
    link.download = `matricula-${kind.toLowerCase()}-template.csv`;
    link.click();
  }

  function downloadCredentials() {
    if (!result) return;
    const rows = [
      'Name,Sign in with,One-time password',
      ...result.credentials.map((c) =>
        [c.name, c.identifier, c.password].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','),
      ),
    ].join('\n');
    const link = document.createElement('a');
    link.href = `data:text/csv;charset=utf-8,${encodeURIComponent(rows)}`;
    link.download = `matricula-passwords-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  }

  function startOver() {
    setText('');
    setFileName(null);
    if (fileInput.current) fileInput.current.value = '';
    window.location.reload();
  }

  // ---------------------------------------------------------------- finished
  if (result) {
    return (
      <>
        <Card>
          <CardHeader
            title={result.created > 0 ? 'Import finished' : 'Nothing was imported'}
            description={run.message}
          />
          <CardBody>
            <div className="grid gap-4 sm:grid-cols-3">
              <StatTile label="Created" value={result.created} tone="success" />
              <StatTile label="Already here" value={result.skipped} />
              <StatTile
                label="Could not import"
                value={result.failed}
                tone={result.failed > 0 ? 'warning' : 'neutral'}
              />
            </div>

            {result.credentials.length > 0 && (
              <Alert tone="warning" title="Download the passwords now" className="mt-4">
                <p>
                  Each new account has a one-time password that <strong>cannot be shown again</strong> —
                  only a hash of it is stored. Download the list and give each person theirs; they
                  will be asked to change it when they first sign in.
                </p>
                <Button className="mt-3" onClick={downloadCredentials} type="button">
                  Download {result.credentials.length} passwords (CSV)
                </Button>
              </Alert>
            )}

            {result.failures.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-medium text-slate-700">
                  These rows were not imported. Fix them in the file and import it again — anybody
                  already created will be skipped.
                </p>
                <div className="max-h-80 overflow-auto rounded-lg border border-slate-200">
                  <Table>
                    <thead>
                      <tr>
                        <Th className="whitespace-nowrap">Line</Th>
                        <Th>Name</Th>
                        <Th>Problem</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {result.failures.map((f) => (
                        <tr key={f.line}>
                          <Td className="text-xs tabular-nums text-slate-500">{f.line}</Td>
                          <Td className="whitespace-nowrap text-xs">{f.name}</Td>
                          <Td className="text-xs text-rose-700">{f.problem}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </div>
            )}

            <Button className="mt-4" variant="ghost" type="button" onClick={startOver}>
              Import another file
            </Button>
          </CardBody>
        </Card>
      </>
    );
  }

  // ----------------------------------------------------------------- preview
  return (
    <>
      <Card>
        <CardHeader
          title="Choose a file"
          description="A spreadsheet saved as CSV. Column names are matched loosely — “Surname”, “Last Name” and “last_name” all work."
        />
        <CardBody>
          <form action={previewAction} className="space-y-4">
            <input type="hidden" name="text" value={text} />

            <Field label="What is in this file?" htmlFor="kind">
              <div className="flex gap-2">
                {(['STUDENT', 'STAFF'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setKind(option)}
                    aria-pressed={kind === option}
                    className={[
                      'h-10 flex-1 rounded-lg border px-3 text-xs font-medium transition-colors',
                      kind === option
                        ? 'border-brand-600 bg-brand-50 text-brand-800'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                    ].join(' ')}
                  >
                    {option === 'STUDENT' ? 'Students' : 'Staff'}
                  </button>
                ))}
              </div>
              <input type="hidden" name="kind" value={kind} />
            </Field>

            <Field
              label="The file"
              htmlFor="file"
              hint="Up to 20,000 rows. Nothing is created until you have seen what it would do."
            >
              <input
                id="file"
                ref={fileInput}
                type="file"
                accept=".csv,text/csv,text/plain"
                onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
                className="block w-full text-xs text-slate-600 file:mr-3 file:h-9 file:cursor-pointer file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:text-xs file:font-medium file:text-onInk hover:file:bg-slate-800"
              />
            </Field>

            {fileName && (
              <p className="text-xs text-slate-500">
                {fileName} — {(text.length / 1024).toFixed(0)} KB
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton>Check the file</SubmitButton>
              <button
                type="button"
                onClick={downloadTemplate}
                className="text-xs font-medium text-brand-700 hover:underline"
              >
                Download a {kind === 'STUDENT' ? 'student' : 'staff'} template
              </button>
            </div>
          </form>

          {preview.ok === false && preview.message && (
            <Alert tone="danger" className="mt-4">
              {preview.message}
            </Alert>
          )}
        </CardBody>
      </Card>

      {plan && (
        <Card className="mt-4">
          <CardHeader
            title="What this would do"
            description="Nothing has been created yet."
          />
          <CardBody>
            <div className="grid gap-4 sm:grid-cols-3">
              <StatTile label="New accounts" value={plan.counts.create} tone="success" />
              <StatTile label="Already here" value={plan.counts.skip} />
              <StatTile
                label="Rejected"
                value={plan.counts.reject}
                tone={plan.counts.reject > 0 ? 'warning' : 'neutral'}
              />
            </div>

            {plan.missingColumns.length > 0 && (
              <Alert tone="danger" title="This file is missing required columns" className="mt-4">
                Nothing can be imported until it has: {plan.missingColumns.join(', ')}.
              </Alert>
            )}

            {plan.unmatchedColumns.length > 0 && (
              <Alert tone="info" title="Some columns are not being read" className="mt-4">
                {plan.unmatchedColumns.join(', ')} — these will be ignored. If one of them holds
                something important, rename it to a name this importer knows and check again.
              </Alert>
            )}

            {plan.counts.reject > 0 && (
              <Alert tone="warning" className="mt-4">
                {plan.counts.reject} {plan.counts.reject === 1 ? 'row' : 'rows'} cannot be imported.
                You can go ahead without them — the rest will be created, and you can fix the file
                and import it again afterwards.
              </Alert>
            )}

            <div className="mt-4 max-h-96 overflow-auto rounded-lg border border-slate-200">
              <Table className="table-zebra">
                <thead>
                  <tr>
                    <Th className="whitespace-nowrap">Line</Th>
                    <Th>Name</Th>
                    <Th>{plan.kind === 'STUDENT' ? 'Programme' : 'Role'}</Th>
                    <Th>Outcome</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sample.map((row) => (
                    <tr key={row.line}>
                      <Td className="text-xs tabular-nums text-slate-500">{row.line}</Td>
                      <Td className="whitespace-nowrap text-xs">
                        <span className="font-medium text-slate-900">
                          {`${row.firstName} ${row.lastName}`.trim() || '—'}
                        </span>
                        <span className="block text-[11px] text-slate-500">
                          {row.email ?? row.username ?? 'no identifier'}
                        </span>
                      </Td>
                      <Td className="whitespace-nowrap text-xs text-slate-600">
                        {plan.kind === 'STUDENT'
                          ? `${row.programmeCode ?? '—'}${row.level ? ` · ${row.level}` : ''}`
                          : (row.role ?? '—')}
                      </Td>
                      <Td>
                        <Badge tone={OUTCOME_TONE[row.outcome]}>{OUTCOME_LABEL[row.outcome]}</Badge>
                        {row.problems.length > 0 && (
                          <span className="mt-1 block text-[11px] text-rose-700">
                            {row.problems.join(' ')}
                          </span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>

            {plan.rows.length > sample.length && (
              <p className="mt-2 text-[11px] text-slate-500">
                Showing {sample.length} of {plan.rows.length} rows, problems first.
              </p>
            )}

            {plan.counts.create > 0 && plan.missingColumns.length === 0 && (
              <form action={runAction} className="mt-4">
                <input type="hidden" name="text" value={text} />
                <input type="hidden" name="kind" value={kind} />
                <SubmitButton>
                  {`Create ${plan.counts.create} ${plan.counts.create === 1 ? 'account' : 'accounts'}`}
                </SubmitButton>
              </form>
            )}
          </CardBody>
        </Card>
      )}

      {run.ok === false && run.message && (
        <Alert tone="danger" className="mt-4">
          {run.message}
        </Alert>
      )}
    </>
  );
}
