'use client';

import { useState } from 'react';

import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { DialogTrigger, MenuItem } from '@/components/ui/overlays';
import { DEGREE_LABELS, type DegreeType } from '@/lib/domain/structure';
import {
  CourseDialog,
  DangerItem,
  DepartmentDialog,
  FacultyDialog,
  ProgrammeDialog,
  RowActions,
  useAction,
  type CourseRow,
  type DepartmentRow,
  type FacultyRow,
  type ProgrammeRow,
} from './editors';
import {
  deleteDepartmentAction,
  deleteFacultyAction,
  setCourseActiveAction,
  setProgrammeActiveAction,
} from './actions';

type Tab = 'faculties' | 'departments' | 'programmes' | 'courses';

const TABS: { id: Tab; label: string; blurb: string }[] = [
  {
    id: 'faculties',
    label: 'Faculties',
    blurb: 'The top level. Everything else in the university hangs off a faculty.',
  },
  {
    id: 'departments',
    label: 'Departments',
    blurb: 'Own the courses and the lecturers who teach them.',
  },
  {
    id: 'programmes',
    label: 'Programmes',
    blurb: 'What a student is admitted to and graduates from.',
  },
  {
    id: 'courses',
    label: 'Courses',
    blurb: 'Units of teaching. Sections of each are timetabled per term.',
  },
];

export function StructureConsole({
  faculties,
  departments,
  programmes,
  courses,
  maxGradePoint,
  canWriteStructure,
}: {
  faculties: FacultyRow[];
  departments: DepartmentRow[];
  programmes: ProgrammeRow[];
  courses: CourseRow[];
  maxGradePoint: number;
  canWriteStructure: boolean;
}) {
  const [tab, setTab] = useState<Tab>('faculties');

  const deleteFaculty = useAction(deleteFacultyAction, 'Faculty deleted');
  const deleteDepartment = useAction(deleteDepartmentAction, 'Department deleted');
  const programmeActive = useAction(setProgrammeActiveAction, 'Programme updated');
  const courseActive = useAction(setCourseActiveAction, 'Course updated');

  const active = TABS.find((t) => t.id === tab)!;

  // The dependency order is the point of this page, so a later tab that cannot
  // be used yet says so rather than presenting an empty table and a create
  // button that will fail.
  const blockedReason =
    tab === 'departments' && faculties.length === 0
      ? 'Create a faculty first — every department belongs to one.'
      : (tab === 'programmes' || tab === 'courses') && departments.length === 0
        ? 'Create a department first — programmes and courses both belong to one.'
        : null;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-1 border-b border-slate-200">
        {TABS.map((t) => {
          const count =
            t.id === 'faculties'
              ? faculties.length
              : t.id === 'departments'
                ? departments.length
                : t.id === 'programmes'
                  ? programmes.length
                  : courses.length;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id}
              className={[
                '-mb-px border-b-2 px-3.5 py-2.5 text-sm font-medium transition',
                tab === t.id
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800',
              ].join(' ')}
            >
              {t.label}
              <span className="ml-1.5 text-[11px] tabular-nums text-slate-400">{count}</span>
            </button>
          );
        })}
      </div>

      <Card>
        <CardHeader
          title={active.label}
          description={active.blurb}
          actions={
            canWriteStructure && !blockedReason ? (
              <NewButton
                tab={tab}
                faculties={faculties}
                departments={departments}
                maxGradePoint={maxGradePoint}
              />
            ) : null
          }
        />

        {blockedReason ? (
          <EmptyState title="Not yet" description={blockedReason} />
        ) : tab === 'faculties' ? (
          faculties.length === 0 ? (
            <EmptyState
              title="No faculties yet"
              description="Start here. A department, a programme and a course all need one to belong to."
            />
          ) : (
            <Table className="table-hover">
              <thead>
                <tr>
                  <Th>Code</Th>
                  <Th>Faculty</Th>
                  <Th className="w-32">Departments</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {faculties.map((f) => (
                  <tr key={f.id}>
                    <Td>
                      <code className="font-mono text-xs font-semibold text-brand-700">
                        {f.code}
                      </code>
                    </Td>
                    <Td className="text-sm text-slate-900">{f.name}</Td>
                    <Td className="text-xs tabular-nums text-slate-600">{f.departmentCount}</Td>
                    <Td className="text-right">
                      {canWriteStructure && (
                        <RowActions
                          destructive={
                            <DangerItem
                              label="Delete faculty"
                              title={`Delete ${f.name}?`}
                              body={
                                f.departmentCount > 0 ? (
                                  <>
                                    This faculty still has{' '}
                                    <strong>
                                      {f.departmentCount}{' '}
                                      {f.departmentCount === 1 ? 'department' : 'departments'}
                                    </strong>
                                    . Deleting it would take them, and everything beneath them,
                                    with it — so this will be refused.
                                  </>
                                ) : (
                                  <>
                                    It is empty, so nothing else is affected. This cannot be
                                    undone.
                                  </>
                                )
                              }
                              onConfirm={() => deleteFaculty.run({ facultyId: f.id })}
                            />
                          }
                        >
                          <FacultyDialog
                            faculty={f}
                            trigger={
                              <DialogTrigger asChild>
                                <MenuItem>Edit faculty</MenuItem>
                              </DialogTrigger>
                            }
                          />
                        </RowActions>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )
        ) : tab === 'departments' ? (
          departments.length === 0 ? (
            <EmptyState title="No departments yet" />
          ) : (
            <Table className="table-hover">
              <thead>
                <tr>
                  <Th>Code</Th>
                  <Th>Department</Th>
                  <Th>Faculty</Th>
                  <Th className="w-40">Contains</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {departments.map((d) => (
                  <tr key={d.id}>
                    <Td>
                      <code className="font-mono text-xs font-semibold text-brand-700">
                        {d.code}
                      </code>
                    </Td>
                    <Td className="text-sm text-slate-900">{d.name}</Td>
                    <Td className="text-xs text-slate-600">{d.facultyCode}</Td>
                    <Td className="text-[11px] text-slate-500">
                      {d.programmeCount} prog · {d.courseCount} courses · {d.lecturerCount} staff
                    </Td>
                    <Td className="text-right">
                      {canWriteStructure && (
                        <RowActions
                          destructive={
                            <DangerItem
                              label="Delete department"
                              title={`Delete ${d.name}?`}
                              body={
                                d.programmeCount + d.courseCount + d.lecturerCount > 0 ? (
                                  <>
                                    This department still has programmes, courses or lecturers
                                    attached. Deleting it would cascade to all of them, so this
                                    will be refused.
                                  </>
                                ) : (
                                  <>It is empty, so nothing else is affected.</>
                                )
                              }
                              onConfirm={() => deleteDepartment.run({ departmentId: d.id })}
                            />
                          }
                        >
                          <DepartmentDialog
                            department={d}
                            faculties={faculties}
                            trigger={
                              <DialogTrigger asChild>
                                <MenuItem>Edit department</MenuItem>
                              </DialogTrigger>
                            }
                          />
                        </RowActions>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )
        ) : tab === 'programmes' ? (
          programmes.length === 0 ? (
            <EmptyState title="No programmes yet" />
          ) : (
            <Table className="table-hover">
              <thead>
                <tr>
                  <Th>Code</Th>
                  <Th>Programme</Th>
                  <Th>Award</Th>
                  <Th className="w-28">Credits</Th>
                  <Th className="w-24">Students</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {programmes.map((p) => (
                  <tr key={p.id} className={p.isActive ? undefined : 'opacity-55'}>
                    <Td>
                      <code className="font-mono text-xs font-semibold text-brand-700">
                        {p.code}
                      </code>
                    </Td>
                    <Td>
                      <div className="text-sm text-slate-900">{p.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {p.durationTerms} terms · min CGPA {p.minCgpa}
                        {p.isActive ? '' : ' · closed to new intake'}
                      </div>
                    </Td>
                    <Td>
                      <Badge tone="neutral">
                        {DEGREE_LABELS[p.degreeType as DegreeType] ?? p.degreeType}
                      </Badge>
                    </Td>
                    <Td className="text-xs tabular-nums text-slate-600">{p.creditsRequired}</Td>
                    <Td className="text-xs tabular-nums text-slate-600">{p.studentCount}</Td>
                    <Td className="text-right">
                      {canWriteStructure && (
                        <RowActions>
                          <ProgrammeDialog
                            programme={p}
                            departments={departments}
                            maxGradePoint={maxGradePoint}
                            trigger={
                              <DialogTrigger asChild>
                                <MenuItem>Edit programme</MenuItem>
                              </DialogTrigger>
                            }
                          />
                          <MenuItem
                            onSelect={() =>
                              programmeActive.run({
                                programmeId: p.id,
                                isActive: String(!p.isActive),
                              })
                            }
                          >
                            {p.isActive ? 'Close to new intake' : 'Reopen'}
                          </MenuItem>
                        </RowActions>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )
        ) : courses.length === 0 ? (
          <EmptyState title="No courses yet" />
        ) : (
          <Table className="table-hover">
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Title</Th>
                <Th className="w-24">Level</Th>
                <Th className="w-24">Credits</Th>
                <Th className="w-28">Sections</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {courses.map((c) => (
                <tr key={c.id} className={c.isActive ? undefined : 'opacity-55'}>
                  <Td>
                    <code className="font-mono text-xs font-semibold text-brand-700">{c.code}</code>
                  </Td>
                  <Td>
                    <div className="text-sm text-slate-900">{c.title}</div>
                    {!c.isActive && <div className="text-[11px] text-slate-500">retired</div>}
                  </Td>
                  <Td className="text-xs tabular-nums text-slate-600">{c.level}</Td>
                  <Td className="text-xs tabular-nums text-slate-600">{c.creditHours}</Td>
                  <Td className="text-xs tabular-nums text-slate-600">{c.offeringCount}</Td>
                  <Td className="text-right">
                    {canWriteStructure && (
                      <RowActions>
                        <CourseDialog
                          course={c}
                          departments={departments}
                          trigger={
                            <DialogTrigger asChild>
                              <MenuItem>Edit course</MenuItem>
                            </DialogTrigger>
                          }
                        />
                        <MenuItem
                          onSelect={() =>
                            courseActive.run({ courseId: c.id, isActive: String(!c.isActive) })
                          }
                        >
                          {c.isActive ? 'Retire course' : 'Reopen'}
                        </MenuItem>
                      </RowActions>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

function NewButton({
  tab,
  faculties,
  departments,
  maxGradePoint,
}: {
  tab: Tab;
  faculties: FacultyRow[];
  departments: DepartmentRow[];
  maxGradePoint: number;
}) {
  const trigger = (label: string) => (
    <DialogTrigger asChild>
      <Button size="sm">{label}</Button>
    </DialogTrigger>
  );

  if (tab === 'faculties') return <FacultyDialog trigger={trigger('New faculty')} />;
  if (tab === 'departments') {
    return <DepartmentDialog faculties={faculties} trigger={trigger('New department')} />;
  }
  if (tab === 'programmes') {
    return (
      <ProgrammeDialog
        departments={departments}
        maxGradePoint={maxGradePoint}
        trigger={trigger('New programme')}
      />
    );
  }
  return <CourseDialog departments={departments} trigger={trigger('New course')} />;
}
