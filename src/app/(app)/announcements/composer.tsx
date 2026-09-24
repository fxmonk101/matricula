'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  ADDRESSABLE_ROLES,
  ANNOUNCEMENT_SEVERITIES,
  SEVERITY_LABELS,
  describeAudience,
  encodeAudience,
  type AnnouncementSeverity,
} from '@/lib/domain/announcement';
import { ROLE_LABELS, type Role } from '@/lib/domain/enums';
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
import { useToast } from '@/components/ui/overlays';
import { postAnnouncementAction, type AnnouncementFormState } from './actions';

/**
 * Writing a school-wide notice.
 *
 * This is the loudest thing in the product: it fills a bell and sends email to
 * everybody it names. So the reach is stated in words, above the button, and
 * recomputed as the boxes are ticked — "Everybody at the school" is a sentence
 * somebody will stop and read, where a row of unticked checkboxes is not.
 *
 * Nothing is ticked by default, and that is deliberate even though empty means
 * everyone. The person has to look at the line that says so.
 */

function PostButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Posting…' : 'Post announcement'}
    </Button>
  );
}

export function Composer({ counts }: { counts: Record<string, number> }) {
  const [state, action] = useActionState<AnnouncementFormState, FormData>(
    postAnnouncementAction,
    {},
  );
  const { push } = useToast();

  const [audience, setAudience] = useState<Role[]>([]);
  const [severity, setSeverity] = useState<AnnouncementSeverity>('INFO');

  useEffect(() => {
    if (!state.message) return;
    push({
      tone: state.ok ? 'success' : 'danger',
      title: state.ok ? 'Announcement posted' : 'Not posted',
      body: state.message,
    });
    if (state.ok) setAudience([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function toggle(role: Role) {
    setAudience((current) =>
      current.includes(role) ? current.filter((r) => r !== role) : [...current, role],
    );
  }

  // The same encoding the server will store, so the sentence below matches what
  // actually happens rather than approximating it.
  const reach = describeAudience(encodeAudience(audience));
  const willReach =
    audience.length === 0
      ? Object.values(counts).reduce((sum, n) => sum + n, 0)
      : audience.reduce((sum, role) => sum + (counts[role] ?? 0), 0);

  return (
    <Card>
      <CardHeader
        title="Write an announcement"
        description="It appears on everybody's dashboard and sends them an email."
      />
      <CardBody>
        <form action={action} className="space-y-4">
          <Field label="Title" htmlFor="title">
            <Input
              id="title"
              name="title"
              maxLength={160}
              placeholder="The school will close early on Friday"
              required
            />
          </Field>

          <Field label="What it says" htmlFor="body">
            <Textarea id="body" name="body" rows={4} maxLength={4000} required />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="How important" htmlFor="severity">
              <Select
                id="severity"
                name="severity"
                value={severity}
                onChange={(e) => setSeverity(e.target.value as AnnouncementSeverity)}
              >
                {ANNOUNCEMENT_SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {SEVERITY_LABELS[s]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Take it down on"
              htmlFor="expiresAt"
              hint="Leave blank to keep it until you remove it"
            >
              <Input id="expiresAt" name="expiresAt" type="datetime-local" />
            </Field>
          </div>

          <Field label="Who it is for" hint="Tick nobody to send it to everybody.">
            <div className="flex flex-wrap gap-2">
              {ADDRESSABLE_ROLES.map((role) => {
                const on = audience.includes(role);
                return (
                  <label
                    key={role}
                    className={[
                      'cursor-pointer rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
                      on
                        ? 'border-brand-600 bg-brand-50 text-brand-800'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                    ].join(' ')}
                  >
                    <input
                      type="checkbox"
                      name="audience"
                      value={role}
                      checked={on}
                      onChange={() => toggle(role)}
                      className="sr-only"
                    />
                    {ROLE_LABELS[role]}
                    <span className="ml-1.5 text-[10px] text-slate-400">{counts[role] ?? 0}</span>
                  </label>
                );
              })}
            </div>
          </Field>

          {/* The sentence somebody stops and reads. */}
          <Alert tone={severity === 'URGENT' ? 'warning' : 'info'}>
            <strong>{reach}</strong> — about {willReach}{' '}
            {willReach === 1 ? 'person' : 'people'} will get a notification and an email.
          </Alert>

          <PostButton />
        </form>

        {state.ok === false && state.message && (
          <Alert tone="danger" className="mt-4">
            {state.message}
          </Alert>
        )}
      </CardBody>
    </Card>
  );
}
