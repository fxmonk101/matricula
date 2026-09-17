'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Alert, Button, Card, CardBody, CardHeader, Field, Input, Select } from '@/components/ui';
import { useToast } from '@/components/ui/overlays';
import { DAYS, DAY_LABELS, type DayOfWeek } from '@/lib/domain/timetable';
import {
  assignLecturerAction,
  saveSlotAction,
  type TimetableFormState,
} from './actions';

export interface SectionOption {
  id: string;
  label: string;
  instructorId: string | null;
  room: string | null;
}
export interface InstructorOption {
  id: string;
  name: string;
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending} className="w-full">
      {pending ? 'Working…' : label}
    </Button>
  );
}

function useResult(state: TimetableFormState, title: string) {
  const { push } = useToast();
  useEffect(() => {
    if (!state.message) return;
    push({
      tone: state.ok ? 'success' : 'danger',
      title: state.ok ? title : 'Not saved',
      body: state.message,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
}

export function SchedulePanel({
  sections,
  instructors,
  maySchedule,
  mayAssign,
}: {
  sections: SectionOption[];
  instructors: InstructorOption[];
  maySchedule: boolean;
  mayAssign: boolean;
}) {
  const [slotState, saveSlot] = useActionState<TimetableFormState, FormData>(saveSlotAction, {});
  const [assignState, assign] = useActionState<TimetableFormState, FormData>(
    assignLecturerAction,
    {},
  );
  useResult(slotState, 'Scheduled');
  useResult(assignState, 'Assigned');

  const [sectionId, setSectionId] = useState(sections[0]?.id ?? '');
  const section = sections.find((s) => s.id === sectionId);

  // Cleared whenever the form changes, so a dean cannot tick "schedule anyway"
  // for one clash and have it silently apply to a different one.
  const [override, setOverride] = useState(false);
  const clashes = slotState.clashes ?? [];

  if (sections.length === 0) {
    return (
      <Card>
        <CardBody>
          <Alert tone="warning" title="No sections in this term">
            A section is a course offered in a term. The registry creates them before anything can
            be timetabled.
          </Alert>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {maySchedule && (
        <Card>
          <CardHeader
            title="Schedule a class"
            description="Adds a weekly slot. Clashes are reported before it is saved."
          />
          <CardBody>
            <form action={saveSlot} className="space-y-3">
              {clashes.length > 0 && (
                <Alert tone="danger" title="This clashes with the timetable">
                  <ul className="mt-1 space-y-1">
                    {clashes.map((c) => (
                      <li key={c} className="text-xs leading-relaxed">
                        {c}
                      </li>
                    ))}
                  </ul>
                  <label className="mt-3 flex items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      name="override"
                      value="true"
                      checked={override}
                      onChange={(e) => setOverride(e.target.checked)}
                      className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300"
                    />
                    <span>
                      Schedule it anyway. The override is recorded in the audit log with the
                      clashes it went over.
                    </span>
                  </label>
                </Alert>
              )}

              <Field label="Section" htmlFor="offeringId" required>
                <Select
                  id="offeringId"
                  name="offeringId"
                  required
                  value={sectionId}
                  onChange={(e) => {
                    setSectionId(e.target.value);
                    setOverride(false);
                  }}
                >
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Day" htmlFor="dayOfWeek" required>
                <Select
                  id="dayOfWeek"
                  name="dayOfWeek"
                  required
                  defaultValue="1"
                  onChange={() => setOverride(false)}
                >
                  {DAYS.map((d) => (
                    <option key={d} value={d}>
                      {DAY_LABELS[d as DayOfWeek]}
                    </option>
                  ))}
                </Select>
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="From" htmlFor="startTime" required>
                  <Input
                    id="startTime"
                    name="startTime"
                    type="time"
                    required
                    defaultValue="08:00"
                    onChange={() => setOverride(false)}
                  />
                </Field>
                <Field label="To" htmlFor="endTime" required>
                  <Input
                    id="endTime"
                    name="endTime"
                    type="time"
                    required
                    defaultValue="10:00"
                    onChange={() => setOverride(false)}
                  />
                </Field>
              </div>

              <Field
                label="Room"
                htmlFor="room"
                hint={
                  section?.room
                    ? `Blank uses the section's own room, ${section.room}.`
                    : 'Optional. Rooms are matched ignoring spacing and punctuation.'
                }
              >
                <Input
                  id="room"
                  name="room"
                  placeholder={section?.room ?? 'LT-1'}
                  onChange={() => setOverride(false)}
                />
              </Field>

              <Submit label={override ? 'Schedule anyway' : 'Add to timetable'} />
            </form>
          </CardBody>
        </Card>
      )}

      {mayAssign && (
        <Card>
          <CardHeader
            title="Assign a lecturer"
            description="Who stands in front of this section. A new double-booking is reported, not refused."
          />
          <CardBody>
            <form action={assign} className="space-y-3">
              {assignState.clashes && assignState.clashes.length > 0 && (
                <Alert tone="warning" title="That lecturer is now double-booked">
                  <ul className="mt-1 space-y-1">
                    {assignState.clashes.map((c) => (
                      <li key={c} className="text-xs leading-relaxed">
                        {c}
                      </li>
                    ))}
                  </ul>
                </Alert>
              )}

              <Field label="Section" htmlFor="assignOffering" required>
                <Select id="assignOffering" name="offeringId" required defaultValue={sectionId}>
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                      {s.instructorId ? '' : ' — unassigned'}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Lecturer" htmlFor="instructorId">
                <Select id="instructorId" name="instructorId" defaultValue="">
                  <option value="">Nobody — leave unassigned</option>
                  {instructors.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Submit label="Assign" />
            </form>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
