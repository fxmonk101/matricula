'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';

import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Select,
  Textarea,
} from '@/components/ui';
import {
  isValidEmail,
  suggestUsername,
  usernameFromMatric,
  usernameRejectionReason,
} from '@/lib/domain/identifier';
import {
  GENDERS,
  levelsForProgramme,
  matricRejectionReason,
  validateDateOfBirth,
} from '@/lib/domain/registration';
import { registerStudentAction, type RegistrationFormState } from './actions';

export interface ProgrammeOption {
  id: string;
  code: string;
  name: string;
  departmentCode: string;
  durationTerms: number;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full sm:w-auto">
      {pending ? 'Registering…' : 'Register student'}
    </Button>
  );
}

export function RegisterStudentForm({ programmes }: { programmes: ProgrammeOption[] }) {
  const [state, action] = useActionState<RegistrationFormState, FormData>(
    registerStudentAction,
    {},
  );

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [matric, setMatric] = useState('');
  const [programmeId, setProgrammeId] = useState(programmes[0]?.id ?? '');
  const [level, setLevel] = useState('100');
  const [dob, setDob] = useState('');

  const programme = programmes.find((p) => p.id === programmeId);
  // The levels offered follow the PROGRAMME, so a four-year degree never shows
  // a level 500 that has no courses behind it.
  const levels = programme ? levelsForProgramme(programme.durationTerms) : [100];

  const emailWrong = email.trim() && !isValidEmail(email) ? 'That does not look like an email address.' : undefined;
  const usernameWrong = username.trim() ? usernameRejectionReason(username) : null;
  const matricWrong = matric.trim() ? matricRejectionReason(matric) : null;
  const dobWrong = dob ? validateDateOfBirth(dob) : null;

  // Mirrors the service: a matriculation number is the better basis, because
  // it is the string a student types from memory years later.
  const derived = matric.trim()
    ? usernameFromMatric(matric)
    : suggestUsername(firstName, lastName);
  const willGenerate = !email.trim() && !username.trim() && Boolean(derived);

  // --- the handover slip ----------------------------------------------------
  if (state.ok && state.matricNumber) {
    return (
      <Card>
        <CardHeader
          title="Registered"
          description="Give the student these details. The password is shown once and cannot be recovered."
        />
        <CardBody className="space-y-4">
          <Alert tone="success">{state.message}</Alert>

          <div className="rounded-xl bg-slate-900 px-5 py-5 text-center">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">
              Matriculation number
            </p>
            <p className="mt-1 font-mono text-xl font-semibold tracking-wide text-white">
              {state.matricNumber}
            </p>
            {state.temporaryPassword ? (
              <>
                <p className="mt-4 text-[11px] uppercase tracking-wide text-slate-400">
                  One-time password
                </p>
                <p className="mt-1 font-mono text-lg font-semibold tracking-widest text-white">
                  {state.temporaryPassword}
                </p>
              </>
            ) : (
              <p className="mt-3 text-xs text-slate-400">
                This person already had an account. They sign in with their existing password.
              </p>
            )}
            {state.studentName && (
              <p className="mt-3 text-xs text-slate-400">{state.studentName}</p>
            )}
          </div>

          <p className="text-xs leading-relaxed text-slate-500">
            They must set their own password the first time they sign in, and cannot reach anything
            else until they do.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" className="no-print" onClick={() => window.print()}>
              Print slip
            </Button>
            <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
              Register another
            </Button>
            <Link
              href="/students"
              className="inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium text-brand-700 hover:underline"
            >
              Back to students
            </Link>
          </div>
        </CardBody>
      </Card>
    );
  }

  if (programmes.length === 0) {
    return (
      <Card>
        <CardBody>
          <Alert tone="warning" title="No programmes to register onto">
            A student is admitted to a programme, so at least one has to exist first. The registry
            creates them under{' '}
            <Link href="/structure" className="font-medium underline">
              Academic structure
            </Link>
            .
          </Alert>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Register a student"
        description="Creates their record, issues a matriculation number, and gives them a one-time password."
      />
      <CardBody>
        <form action={action} className="space-y-5">
          {state.message && !state.ok && <Alert tone="danger">{state.message}</Alert>}

          {/* ---------------------------------------------------- the person */}
          <div>
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">
              The person
            </p>
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="First name" htmlFor="firstName" required>
                  <Input
                    id="firstName"
                    name="firstName"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    autoComplete="off"
                  />
                </Field>
                <Field label="Last name" htmlFor="lastName" required>
                  <Input
                    id="lastName"
                    name="lastName"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    autoComplete="off"
                  />
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Email"
                  htmlFor="email"
                  error={emailWrong}
                  hint="Optional."
                >
                  <Input
                    id="email"
                    name="email"
                    type="text"
                    inputMode="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                  />
                </Field>
                <Field
                  label="Username"
                  htmlFor="username"
                  error={usernameWrong ?? undefined}
                  hint={
                    willGenerate
                      ? 'Leave blank and they will be given "' + derived + '".'
                      : 'Optional. What they type to sign in.'
                  }
                >
                  <Input
                    id="username"
                    name="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase())}
                    placeholder={derived || 'a.okafor'}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                  />
                </Field>
              </div>

              {!email.trim() && !username.trim() && !derived && (
                <Alert tone="warning">
                  Enter a name, an email address or a username. Without one of them this student has
                  no way to sign in.
                </Alert>
              )}
            </div>
          </div>

          {/* ------------------------------------------------- the admission */}
          <div className="border-t border-slate-200/70 pt-5">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">
              The admission
            </p>
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
                <Field label="Programme" htmlFor="programmeId" required>
                  <Select
                    id="programmeId"
                    name="programmeId"
                    required
                    value={programmeId}
                    onChange={(e) => {
                      setProgrammeId(e.target.value);
                      // A level the new programme does not run would otherwise
                      // stay selected and be refused on submit.
                      const next = programmes.find((p) => p.id === e.target.value);
                      const allowed = next ? levelsForProgramme(next.durationTerms) : [100];
                      if (!allowed.includes(Number(level))) setLevel(String(allowed[0]));
                    }}
                  >
                    {programmes.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.code} — {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field
                  label="Level"
                  htmlFor="level"
                  required
                  hint={programme ? `Runs to ${levels[levels.length - 1]}.` : undefined}
                >
                  <Select
                    id="level"
                    name="level"
                    required
                    value={level}
                    onChange={(e) => setLevel(e.target.value)}
                  >
                    {levels.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <Field
                label="Matriculation number"
                htmlFor="matricNumber"
                error={matricWrong ?? undefined}
                hint="Leave blank to have one issued. Type one in when transferring an existing record — a number already printed on a certificate must never be replaced."
              >
                <Input
                  id="matricNumber"
                  name="matricNumber"
                  value={matric}
                  onChange={(e) => setMatric(e.target.value.toUpperCase())}
                  placeholder="Issued automatically"
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
            </div>
          </div>

          {/* ------------------------------------------------------ optional */}
          <details className="border-t border-slate-200/70 pt-5">
            <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-slate-500">
              Personal details (optional)
            </summary>
            <div className="mt-3 space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Date of birth" htmlFor="dateOfBirth" error={dobWrong ?? undefined}>
                  <Input
                    id="dateOfBirth"
                    name="dateOfBirth"
                    type="date"
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                  />
                </Field>
                <Field label="Gender" htmlFor="gender">
                  <Select id="gender" name="gender" defaultValue="">
                    <option value="">Not stated</option>
                    {GENDERS.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Phone" htmlFor="phone">
                  <Input id="phone" name="phone" type="tel" autoComplete="off" />
                </Field>
              </div>
              <Field label="Nationality" htmlFor="nationality">
                <Input id="nationality" name="nationality" autoComplete="off" />
              </Field>
              <Field label="Address" htmlFor="address">
                <Textarea id="address" name="address" rows={2} />
              </Field>
            </div>
          </details>

          <div className="border-t border-slate-200/70 pt-4">
            <SubmitButton />
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
