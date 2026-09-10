'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Alert, Button, Field, Input, Select, Textarea } from '@/components/ui';
import {
  ConfirmDialog,
  Dialog,
  DialogClose,
  DialogContent,
  Menu,
  MenuButton,
  MenuContent,
  MenuItem,
  MenuSeparator,
  useToast,
} from '@/components/ui/overlays';
import {
  DEGREE_LABELS,
  DEGREE_TYPES,
  LEVELS,
  codeRejectionReason,
  levelFromCourseCode,
  normaliseCode,
} from '@/lib/domain/structure';
import {
  deleteDepartmentAction,
  deleteFacultyAction,
  saveCourseAction,
  saveDepartmentAction,
  saveFacultyAction,
  saveProgrammeAction,
  setCourseActiveAction,
  setProgrammeActiveAction,
  type StructureFormState,
} from './actions';

export interface FacultyRow {
  id: string;
  code: string;
  name: string;
  departmentCount: number;
}
export interface DepartmentRow {
  id: string;
  code: string;
  name: string;
  facultyId: string;
  facultyCode: string;
  programmeCount: number;
  courseCount: number;
  lecturerCount: number;
}
export interface ProgrammeRow {
  id: string;
  code: string;
  name: string;
  degreeType: string;
  departmentId: string;
  creditsRequired: number;
  durationTerms: number;
  minCgpa: number;
  isActive: boolean;
  studentCount: number;
}
export interface CourseRow {
  id: string;
  code: string;
  title: string;
  description: string | null;
  departmentId: string;
  creditHours: number;
  level: number;
  isActive: boolean;
  offeringCount: number;
}

function SaveButton({ label = 'Save' }: { label?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Saving…' : label}
    </Button>
  );
}

/**
 * Close the dialog and announce the result, but only once the action has
 * actually succeeded.
 *
 * Closing optimistically on submit is the common mistake: the dialog vanishes,
 * the save fails, and the only evidence is a message on a panel that is no
 * longer on screen.
 */
function useDialogResult(
  state: StructureFormState,
  onSuccess: () => void,
  successTitle = 'Saved',
) {
  const { push } = useToast();
  useEffect(() => {
    if (state.ok && state.message) {
      push({ tone: 'success', title: successTitle, body: state.message });
      onSuccess();
    }
    // `state` is replaced wholesale by useActionState on each result, so
    // identity is a sound dependency here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
}

// -----------------------------------------------------------------------------
// Faculty
// -----------------------------------------------------------------------------

export function FacultyDialog({
  faculty,
  trigger,
}: {
  faculty?: FacultyRow;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<StructureFormState, FormData>(saveFacultyAction, {});
  const [code, setCode] = useState(faculty?.code ?? '');
  useDialogResult(state, () => setOpen(false));

  const codeProblem = code ? codeRejectionReason(code, 'unit') : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger}
      <DialogContent
        title={faculty ? `Edit ${faculty.name}` : 'New faculty'}
        description="A faculty groups departments. Everything else in the university hangs off one."
        footer={
          <>
            <DialogClose asChild>
              <Button variant="secondary" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button form="faculty-form" type="submit" size="sm">
              {faculty ? 'Save changes' : 'Create faculty'}
            </Button>
          </>
        }
      >
        <form id="faculty-form" action={action} className="space-y-4">
          {state.message && !state.ok && <Alert tone="danger">{state.message}</Alert>}
          {faculty && <input type="hidden" name="facultyId" value={faculty.id} />}

          <Field
            label="Code"
            htmlFor="faculty-code"
            required
            hint="Short, capitalised. Quoted aloud in the registry and printed on documents."
            error={codeProblem ?? undefined}
          >
            <Input
              id="faculty-code"
              name="code"
              required
              value={code}
              onChange={(e) => setCode(normaliseCode(e.target.value))}
              placeholder="SCI"
              maxLength={12}
            />
          </Field>

          <Field label="Name" htmlFor="faculty-name" required>
            <Input
              id="faculty-name"
              name="name"
              required
              defaultValue={faculty?.name}
              placeholder="Faculty of Science"
            />
          </Field>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Department
// -----------------------------------------------------------------------------

export function DepartmentDialog({
  department,
  faculties,
  defaultFacultyId,
  trigger,
}: {
  department?: DepartmentRow;
  faculties: FacultyRow[];
  defaultFacultyId?: string;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<StructureFormState, FormData>(saveDepartmentAction, {});
  const [code, setCode] = useState(department?.code ?? '');
  useDialogResult(state, () => setOpen(false));

  const codeProblem = code ? codeRejectionReason(code, 'unit') : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger}
      <DialogContent
        title={department ? `Edit ${department.name}` : 'New department'}
        description="Departments own the courses and the lecturers who teach them."
        footer={
          <>
            <DialogClose asChild>
              <Button variant="secondary" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button form="department-form" type="submit" size="sm">
              {department ? 'Save changes' : 'Create department'}
            </Button>
          </>
        }
      >
        <form id="department-form" action={action} className="space-y-4">
          {state.message && !state.ok && <Alert tone="danger">{state.message}</Alert>}
          {department && <input type="hidden" name="departmentId" value={department.id} />}

          <Field label="Faculty" htmlFor="department-faculty" required>
            <Select
              id="department-faculty"
              name="facultyId"
              required
              defaultValue={department?.facultyId ?? defaultFacultyId ?? ''}
            >
              <option value="" disabled>
                Choose a faculty
              </option>
              {faculties.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.code} — {f.name}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
            <Field label="Code" htmlFor="department-code" required error={codeProblem ?? undefined}>
              <Input
                id="department-code"
                name="code"
                required
                value={code}
                onChange={(e) => setCode(normaliseCode(e.target.value))}
                placeholder="CSC"
                maxLength={12}
              />
            </Field>
            <Field label="Name" htmlFor="department-name" required>
              <Input
                id="department-name"
                name="name"
                required
                defaultValue={department?.name}
                placeholder="Computer Science"
              />
            </Field>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Programme
// -----------------------------------------------------------------------------

export function ProgrammeDialog({
  programme,
  departments,
  maxGradePoint,
  trigger,
}: {
  programme?: ProgrammeRow;
  departments: DepartmentRow[];
  maxGradePoint: number;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<StructureFormState, FormData>(saveProgrammeAction, {});
  const [code, setCode] = useState(programme?.code ?? '');
  useDialogResult(state, () => setOpen(false));

  const codeProblem = code ? codeRejectionReason(code, 'unit') : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger}
      <DialogContent
        wide
        title={programme ? `Edit ${programme.name}` : 'New programme'}
        description="What a student is admitted to and graduates from."
        footer={
          <>
            <DialogClose asChild>
              <Button variant="secondary" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button form="programme-form" type="submit" size="sm">
              {programme ? 'Save changes' : 'Create programme'}
            </Button>
          </>
        }
      >
        <form id="programme-form" action={action} className="space-y-4">
          {state.message && !state.ok && <Alert tone="danger">{state.message}</Alert>}
          {programme && <input type="hidden" name="programmeId" value={programme.id} />}

          <Field label="Department" htmlFor="programme-department" required>
            <Select
              id="programme-department"
              name="departmentId"
              required
              defaultValue={programme?.departmentId ?? ''}
            >
              <option value="" disabled>
                Choose a department
              </option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} — {d.name}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
            <Field label="Code" htmlFor="programme-code" required error={codeProblem ?? undefined}>
              <Input
                id="programme-code"
                name="code"
                required
                value={code}
                onChange={(e) => setCode(normaliseCode(e.target.value))}
                placeholder="BSCCSC"
                maxLength={12}
              />
            </Field>
            <Field label="Name" htmlFor="programme-name" required>
              <Input
                id="programme-name"
                name="name"
                required
                defaultValue={programme?.name}
                placeholder="B.Sc. Computer Science"
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Award" htmlFor="programme-degree" required>
              <Select
                id="programme-degree"
                name="degreeType"
                required
                defaultValue={programme?.degreeType ?? 'BSC'}
              >
                {DEGREE_TYPES.map((d) => (
                  <option key={d} value={d}>
                    {DEGREE_LABELS[d]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Duration"
              htmlFor="programme-terms"
              required
              hint="In terms, not years."
            >
              <Input
                id="programme-terms"
                name="durationTerms"
                type="number"
                min={1}
                max={24}
                required
                defaultValue={programme?.durationTerms ?? 8}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Credits to graduate"
              htmlFor="programme-credits"
              required
            >
              <Input
                id="programme-credits"
                name="creditsRequired"
                type="number"
                min={1}
                max={600}
                required
                defaultValue={programme?.creditsRequired ?? 120}
              />
            </Field>
            <Field
              label="Minimum CGPA"
              htmlFor="programme-cgpa"
              required
              hint={`On this school's ${maxGradePoint}-point scale.`}
            >
              <Input
                id="programme-cgpa"
                name="minCgpa"
                type="number"
                step="0.01"
                min={0}
                max={maxGradePoint}
                required
                defaultValue={programme?.minCgpa ?? 1.5}
              />
            </Field>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Course
// -----------------------------------------------------------------------------

export function CourseDialog({
  course,
  departments,
  trigger,
}: {
  course?: CourseRow;
  departments: DepartmentRow[];
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<StructureFormState, FormData>(saveCourseAction, {});
  const [code, setCode] = useState(course?.code ?? '');
  const [level, setLevel] = useState(String(course?.level ?? 100));
  useDialogResult(state, () => setOpen(false));

  const codeProblem = code ? codeRejectionReason(code, 'course') : null;
  // Most West African universities encode the level in the number, so typing
  // it twice is an invitation to disagree with yourself. Suggested, never
  // forced — plenty of institutions do not use that convention.
  const suggested = levelFromCourseCode(code);
  const levelDisagrees = suggested !== null && String(suggested) !== level;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger}
      <DialogContent
        wide
        title={course ? `Edit ${course.code}` : 'New course'}
        description="A unit of teaching. Sections of it are timetabled per term."
        footer={
          <>
            <DialogClose asChild>
              <Button variant="secondary" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button form="course-form" type="submit" size="sm">
              {course ? 'Save changes' : 'Create course'}
            </Button>
          </>
        }
      >
        <form id="course-form" action={action} className="space-y-4">
          {state.message && !state.ok && <Alert tone="danger">{state.message}</Alert>}
          {course && <input type="hidden" name="courseId" value={course.id} />}

          <Field label="Department" htmlFor="course-department" required>
            <Select
              id="course-department"
              name="departmentId"
              required
              defaultValue={course?.departmentId ?? ''}
            >
              <option value="" disabled>
                Choose a department
              </option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} — {d.name}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
            <Field label="Code" htmlFor="course-code" required error={codeProblem ?? undefined}>
              <Input
                id="course-code"
                name="code"
                required
                value={code}
                onChange={(e) => setCode(normaliseCode(e.target.value))}
                placeholder="CSC101"
                maxLength={16}
              />
            </Field>
            <Field label="Title" htmlFor="course-title" required>
              <Input
                id="course-title"
                name="title"
                required
                defaultValue={course?.title}
                placeholder="Introduction to Computer Science"
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Credit hours" htmlFor="course-credits" required>
              <Input
                id="course-credits"
                name="creditHours"
                type="number"
                min={0}
                max={60}
                required
                defaultValue={course?.creditHours ?? 3}
              />
            </Field>
            <Field
              label="Level"
              htmlFor="course-level"
              required
              hint={
                levelDisagrees
                  ? `The code suggests ${suggested}. Keep your choice if that is right.`
                  : undefined
              }
            >
              <Select
                id="course-level"
                name="level"
                required
                value={level}
                onChange={(e) => setLevel(e.target.value)}
              >
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="Description" htmlFor="course-description">
            <Textarea
              id="course-description"
              name="description"
              rows={3}
              defaultValue={course?.description ?? ''}
              placeholder="Foundations of computing, algorithms and problem decomposition."
            />
          </Field>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Row actions
// -----------------------------------------------------------------------------

/**
 * Run a server action from somewhere that is not a form.
 *
 * A menu item is a button inside a portalled menu, so it cannot sit inside the
 * form it submits — the previous shape used hidden forms and `form=` targets,
 * which worked and read like a workaround. This builds the FormData directly
 * and reports the result as a toast.
 */
export function useAction(
  action: (prev: StructureFormState, data: FormData) => Promise<StructureFormState>,
  successTitle: string,
) {
  const [state, submit, pending] = useActionState<StructureFormState, FormData>(action, {});
  const { push } = useToast();

  useEffect(() => {
    if (!state.message) return;
    push({
      tone: state.ok ? 'success' : 'danger',
      title: state.ok ? successTitle : 'Not done',
      body: state.message,
    });
    // `state` is replaced wholesale on each result, so identity is sound here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const run = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [name, value] of Object.entries(fields)) data.append(name, value);
    submit(data);
  };

  return { run, pending, state };
}

/**
 * A dropdown, not an inline expansion.
 *
 * The previous pattern expanded controls inside the table cell, which stretched
 * the row and clipped anything that overflowed. A portalled menu escapes the
 * cell entirely and takes its keyboard handling — typeahead, arrow keys, Escape
 * -- with it.
 */
export function RowActions({
  children,
  destructive,
}: {
  children: React.ReactNode;
  /** Rendered under a separator, at the bottom, away from the safe items. */
  destructive?: React.ReactNode;
}) {
  return (
    <Menu>
      <MenuButton label="Manage" />
      <MenuContent>
        {children}
        {destructive ? (
          <>
            <MenuSeparator />
            {destructive}
          </>
        ) : null}
      </MenuContent>
    </Menu>
  );
}

/**
 * A menu item that asks before it acts.
 *
 * Deletion of structure cascades in the schema, so the confirmation carries the
 * CONSEQUENCE rather than the word "confirm" — a registrar clicking through a
 * dialog that says "Are you sure?" learns nothing they did not already assume.
 */
export function DangerItem({
  label,
  title,
  body,
  onConfirm,
}: {
  label: string;
  title: string;
  body: React.ReactNode;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <MenuItem destructive onSelect={() => setOpen(true)}>
        {label}
      </MenuItem>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        body={body}
        confirmLabel={label}
        destructive
        onConfirm={onConfirm}
      />
    </>
  );
}

export { MenuItem };
