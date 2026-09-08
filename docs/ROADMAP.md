# Platform Roadmap
## From single-university SIS → multi-tenant school platform

**Status:** Phases 0-4 **complete**. Phase 5 next. Phases ship independently; each ends with a green build, green tests, and a demoable app.

| Phase | State |
|---|---|
| 0 — Tenancy & identity foundation | ✅ Done — 20 isolation tests, verified end-to-end in the running app |
| 1 — Per-school configuration & setup console | ✅ Done — config drives grading, currency and rules; 24 new tests |
| 2 — K-12 academic model & guardians | ✅ Done — 38 K-12 tests; report cards, mark sheets and guardian portal verified live |
| 3 — Org hierarchy, tasks, notifications, shell | ✅ Done — 72 new tests; dean workflow verified live at both universities |
| 4 — Forums | ✅ Done — 97 new tests incl. 12 XSS payloads; CSP shipped; verified live |
| 5 — Digital resource library | Planned |
| 6 — UI system pass | Planned |

---

## Context

The system today ([README.md](../README.md)) is a **single-tenant university SIS**: one institution, hard-coded in environment variables, with a 4.0 GPA scale, Naira currency, and a university-shaped academic model (Faculty → Department → Program → Course → CGPA → matriculation). ~12,300 lines, 128 passing tests.

The goal is a **multi-tenant platform** that any school — national or international, university or K-12 — can be provisioned onto and configure for itself: its own faculties or year groups, its own grading scheme, currency, branding, and registration portal. On top of that sit the collaboration features a real school runs on: a reporting hierarchy with task assignment, staff and student forums, and a digital resource library.

### Decisions taken

| Decision | Choice | Consequence |
|---|---|---|
| Scope | Full roadmap, phased across sessions | 7 phases below, each independently shippable |
| School types | **Both K-12 and higher education** from the start | `School.academicModel` switches terminology, navigation, and which academic engines run. Adds Phase 2. |
| Sign-in | **Unified login, SSO-ready** | One global identity + per-school `Membership`. `IdentityProvider` table ships unused so Entra/Google SSO is additive later, not a migration. |
| Library | **Digital resources only** | No copies, loans, due dates, reservations, or fines. No finance integration. Phase 5 shrinks substantially. |
| Design | **Enterprise aesthetic, mocked first** | Denser, formal, staff-power-user oriented — Workday Student / SharePoint / PowerSchool admin. Design canvas for review before UI code. |
| Onboarding | **Platform admin provisions, school configures** | No public signup. Operator creates the school + first admin; that admin runs a self-service setup wizard. |

### Architecture principle (unchanged)

**Decisions are pure, persistence is transactional, and the two never mix.** Every new module follows the existing split — pure algorithms in `src/lib/domain/`, transactional wrappers in `src/server/`. See [ALGORITHMS.md](ALGORITHMS.md).

---

## Phase 0 — Tenancy and identity foundation ✅

Everything depends on this. Nothing else starts until it is green.

### What shipped, and what was verified

**Four Prisma behaviours the design rests on were tested, not assumed** — a probe
established each before a line of the isolation layer was written, and
`tests/tenant.test.ts` now pins all four so a client upgrade cannot quietly
remove one:

1. `extendedWhereUnique` is on, so `findUnique({ where: { id, schoolId } })` is legal.
2. A cross-tenant `findUnique` returns `null`, not the row.
3. A cross-tenant `update`/`delete` **throws** rather than mutating. Fail-closed.
4. The extension survives into interactive `$transaction` — where every service body runs.

**Verified live in the running app**, not just in tests:

| Check | Result |
|---|---|
| GEU admin `/students` | 6 GEU students, 0 Meridian |
| Meridian admin `/students` | 2 Meridian students, 0 GEU |
| Either admin fetching the other's student by direct id | `404` |
| Dual-school person signed in at Meridian | Meridian branding, Meridian courses, zero GEU references |
| Per-school `/s/<slug>/apply` | Only that school's programmes |
| Unknown slug | `404` |
| Meridian **ADMIN** → `/admin/platform` | `307 /forbidden` — the platform gate checks the claim, not the role |

**Two real defects were found and fixed during the phase**, both the kind that
only surface with a second tenant present:

- The seed double-billed a student because a 3-pattern fee loop was padded
  against a 2-student school. The `UNIQUE(studentId, termId)` constraint caught
  it — the anti-double-billing guard doing its job.
- Page titles came from `NEXT_PUBLIC_INSTITUTION_NAME`, so a user signed in at
  Meridian saw "· GEU" in the browser tab. The env-based `INSTITUTION` constant
  is now deleted outright; branding comes from the school row.

**Data model**
- New: `School` (slug, code, name, `academicModel`, locale, timezone, currency, brand colour, logo, status), `SchoolConfig`, `Membership`, `PlatformAdmin`, `OrgUnit`, `IdentityProvider` (ships unused).
- `schoolId` on all 25 tenant-owned models, added in **two migrations**: nullable + backfill, then `NOT NULL`. Non-null is a security feature — if scoping ever fails to inject, the write fails closed rather than writing an unscoped row.
- Global `@unique` codes → `@@unique([schoolId, code])`. `User.email` **stays globally unique** — identity is global, authorisation is per-membership.
- `User.role` moves to `Membership.role`, alongside `title`, `orgUnitId`, `managerId`.

**Tenant isolation** — the critical safety work, in new `src/lib/tenant.ts`:
- `dbFor(schoolId)` — memoised Prisma client extension injecting `where.schoolId` on reads and `data.schoolId` on creates.
- Systematic `findUnique({where:{id}})` → `findFirst` rewrite, since Prisma rejects a non-unique filter on `findUnique`. Every service does this today.
- Nested writes (`meetings: { create: [...] }`, `lines: { create: ... }`) are **not** walked by the extension — services set `schoolId` explicitly.
- `getTenantContext()` for requests; `forSchool(schoolId)` entrypoint that does not touch cookies, so the seed and maintenance scripts work.
- **Postgres Row-Level Security** is the production guarantee; the extension is dev parity and defence in depth. This mirrors the existing stance on middleware.
- **Cross-tenant test matrix**: for every tenant model, seed two schools and assert school A can never read, update, or delete school B's rows.

**Auth** — `SessionClaims` gains `sch`, `mbr`, optional `pa`. `requireTenant()`, `requirePlatformAdmin()`. Login at `/s/[slug]/login` (path-prefix tenancy; subdomains behind a flag — `*.localhost` is unreliable on Windows).

**Also**: per-school document numbering (`INV-{schoolCode}-{year}-{n}`), `AuditLog.schoolId` (nullable — platform actions have none), `academics.ts` takes a `schoolId`, seed becomes `seedSchool()` called twice.

**Key files:** `prisma/schema.prisma`, new `src/lib/tenant.ts`, `src/lib/auth/{jwt,session,rbac}.ts`, `src/middleware.ts`, all of `src/server/services/*`, `prisma/seed.ts`.

---

## Phase 1 — Per-school configuration and setup console ✅

### What shipped

Every policy constant is now per-school DATA. `src/lib/domain/config.ts` holds
the types, Zod schemas, presets and validators; the pure functions take an
optional config parameter **defaulting to the previous constant**, which is how
148 existing tests stayed green through the refactor.

`src/server/school-config.ts` loads and memoises the parsed bundle;
`/settings/school` lets an administrator edit grading, enrolment rules, the
admissions rubric and branding, with contiguity and weight-sum validation at
save time rather than module load.

**Verified live:** the same score of 84 grades to 4.00 points at Golden Eagles
and 5.00 at Meridian; a CGPA of 2.20 is good standing at one and a warning at
the other; students see ₦ or ₵ according to their school; and switching
Meridian's scale to 4.0 and back round-trips every CGPA exactly.

### Three defects found, all the same shape

Each was code computing grades with its own arithmetic instead of the shared
scale — invisible until a second scale existed:

1. **Seeded config failed validation silently.** It lacked `maxGradePoint` and
   `degreeClasses`, so the loader fell back to defaults and *both* schools ran
   on 4.0. The seed now builds config through the same module the app parses.
2. **A scale change moved nothing.** `recomputeStudentAcademics` aggregated the
   *stored* grade points, so a school could change its scale and see no effect
   on any transcript. It now re-derives letter and point from the stored raw
   score — the score is the fact, the grade is an interpretation of it.
3. **The seed graded on different maths than the app** (`max - 1` for a B
   versus `max/4` steps), so a freshly seeded 5.0 grade disagreed with what the
   app would compute for the identical score.

**Config refactor.** Every hard-coded policy constant becomes per-school data. New pure module `src/lib/domain/config.ts` holds the types, Zod schemas, and named presets (`DEFAULT_`, `NIGERIAN_5POINT_`, `US_4POINT_`, `UK_HONOURS_`, `IB_`).

Externalised: `GRADE_SCALE`, `SPECIAL_GRADES`, `PASSING_GRADE_POINT`, `ASSESSMENT_WEIGHTS`, `STANDING_THRESHOLDS`, `DEGREE_CLASSES` (grading.ts) · `REGISTRATION_POLICY` (enrollment.ts) · `ADMISSION_WEIGHTS` and thresholds (admissions.ts) · `FINANCIAL_HOLD_POLICY`, `REFUND_SCHEDULE` (finance.ts) · `CURRENCY` (money.ts) · `INSTITUTION` (utils.ts).

Stays global — platform logic, not tenant policy: the application state machine, all enum tuples, `DAY_NAMES`, ageing buckets, the half-up rounding rule, and the integer-minor-unit invariant.

**Purity is preserved** by adding an optional config parameter that defaults to today's constant: `scoreToGrade(total, scale = DEFAULT.scale)`. The 128 existing tests stay green because the default *is* current behaviour; new parametrised suites prove a 5.0 scale and a 4.0 scale produce different, correct results from identical scores.

`assertScaleIsWellFormed` / `assertWeightsSumToOne` move from module load to **config-save time** — otherwise a bad config silently mis-grades.

**Setup console** — `/settings/school` with tabs: General · Branding · Grading · Enrolment · Admissions · Finance · Terms · Registration Portal · Roles. Plus an onboarding wizard for a newly provisioned school.

**Branding** — `tailwind.config.ts` brand ramp moves to `rgb(var(--brand-600) / <alpha-value>)`, so `School.brandColor` flows through every existing `bg-brand-*` without touching call sites.

---

## Phase 2 — K-12 academic model and guardian accounts ✅

The university model does not fit a primary or secondary school. `School.academicModel` (`HIGHER_ED` | `K12`) selects which engines and vocabulary apply.

| Concept | Higher education | K-12 |
|---|---|---|
| Structure | Faculty → Department → Program | School section → Year group → Form class |
| Unit of study | Course with credit hours | Subject, no credits |
| Enrolment | Student registers per section | Student assigned to a form class; subjects follow |
| Assessment | CA + exam → GPA/CGPA | CA + exam → subject grade, class position, teacher remark |
| Output | Transcript, degree classification | Termly report card, promotion decision |
| Identity | Matriculation number | Admission number |
| Guardians | Rare | **Core** — parents need grades, fees, attendance |

**New**: `YearGroup`, `FormClass`, `Subject`, `SubjectAssignment`, `ReportCard`, `ReportCardLine`, `Guardian`, `GuardianStudent`, plus `Attendance` (both models need it, and K-12 requires it).

**New pure module** `src/lib/domain/k12.ts`: subject grading against the school's scale, class-position ranking with correct tie handling, term average, promotion/retention rules, attendance-rate computation.

**Guardian experience**: `GUARDIAN` role, linked to one or more students possibly across schools — which is exactly why Phase 0 models `Membership` rather than putting a school on the user.

### What shipped, and what was verified

**Pure engine** — `src/lib/domain/k12.ts`, 38 tests. The pieces that needed a decision rather than a formula:

- **Competition ranking (1224)** for class position. Tied pupils share a position and the next one skips; dense ranking (1223) would understate how many pupils are ahead, and ordinal ranking (1234) would break a genuine tie by row order, which is arbitrary and indefensible to a parent.
- **A blank mark is not a zero.** A subject with either component missing is "not assessed" and is excluded from *both* the numerator and the denominator of the average — the same treatment a withdrawal gets in a GPA. Scoring it zero puts a fail on a report card for a paper the pupil never sat.
- **The term average is a plain mean, not credit-weighted.** K-12 subjects carry no credits; weighting them would invent a hierarchy the school never declared.
- **Attendance:** `LATE` counts as present, `EXCUSED` leaves the denominator, and no records at all means fully present rather than 0%.
- **Promotion is a cascade with a fixed order** — repeat floor → compulsory-subject failure → attendance → promotion mark → terminal year → promoted. `REPEAT` always sets `requiresReview`: no child repeats a year because an algorithm said so and nobody looked.

**Report cards are generated for the CLASS, never one pupil at a time.** Position-in-class and the class average are properties *of the class*; generating card by card would either recompute the cohort on every card or report a position derived from whoever happened to be generated so far. Same reason mark sheets save whole-class.

**Publication is a separate act from generation**, and a published card is frozen — a re-run skips it. A draft is the office's working document; a published card is a document a parent holds, and it must not change underneath them.

**Defect found and fixed:** the first generator trusted the stored `totalScore`, which the seed had never computed, so every report card came out with null totals. Fixed by re-deriving each mark from the raw CA and exam scores through the school's *current* scale — the same principle Phase 1 applied to GPA. **The raw score is the fact; the letter, the point and the total are an interpretation of it, and the interpretation belongs to whichever scale the school publishes today.**

**Verified live in the running app** (production build, four minted sessions against the seeded `gis` school):

| Check | Result |
|---|---|
| Report card arithmetic | Every card's subject lines sum exactly to its stated total (Amara Nwosu 742 → 74.2 average, grade A) |
| Tie handling | Two pupils at 742 both hold 3rd; the next holds 5th — the skip is real, not cosmetic |
| Compulsory-subject rule | Chinedu Eze → `REVIEW`, reason "Did not pass compulsory subjects: ENG, MTH." |
| Same document both sides | `/reports/[id]` (registrar) and `/family/[id]` (that pupil's guardian) render identical figures and reference number |
| Guardian authorisation by **link**, not role | A guardian requesting another family's child gets **404**, not 403 — the response does not confirm the pupil exists |
| Role gating | Guardian → `/classes` and `/reports` redirect to `/forbidden`; registrar → `/family` likewise |
| Subject-teacher ownership | A teacher sees their own subject editable and another teacher's read-only, on the same route |
| Academic-model gating | A `HIGHER_ED` school reaching `/classes` gets an explanatory panel, not a 404 — an administrator needs to know the page exists and what would fill it |

**Not exercised end-to-end:** the mark-sheet and report-generation *write* paths were driven through their services (the seed calls the real `saveSubjectMarks` and `generateClassReportCards`) but not submitted through the rendered HTML form, because every seeded card is already published and therefore correctly refuses regeneration.

210 tests green · `tsc --noEmit` clean · production build clean.

---

## Phase 3 — Org hierarchy, task system, notifications, new shell ✅

The SharePoint-like layer.

**Hierarchy** — `Membership.managerId` self-relation plus the `OrgUnit` tree from Phase 0. `org.service.ts` resolves subordinates by iterative BFS, request-cached.

**Tasks** — `Task`, `TaskComment`, `TaskEvent`, `TaskWatcher`. Types: course/subject assignment, grade submission, document request, onboarding, moderation, generic. Pure `src/lib/domain/tasks.ts`: status state machine (mirroring the existing application state machine), overdue/SLA math, escalation rule, completion statistics, workload balance for fair course distribution.

**The dean workflow**, concretely: assigning `CourseOffering.instructorId` auto-creates a task for that teacher; `/team` aggregates subordinates' completion rates, grading progress, and overdue work; a report generator produces an activity report over a date range for a person or unit.

**Authorisation nuance** — "a manager can see a subordinate's tasks" is *relationship*-based, not role-based. It does not belong in `rbac.ts`. The pure predicate lives in `tasks.ts`; the subordinate set is resolved in `org.service.ts`; every action guards the **route** with `requireRole` and then the **record** with `assertCanViewTask` — the same two-layer pattern the registration actions already use.

**Notifications** — `Notification` model, fan-out on task assigned/due/escalated, grade posted, forum reply, application decision. Bell in the top bar. Channel abstraction stubbed for email later.

**Shell MVP** — sidebar navigation, top bar, notification bell, role-aware `/home` start page. New modules land in the new shell; legacy pages migrate in Phase 6.

### What shipped, and what was verified

**Scoped to the two universities** at your request. The K-12 school has the schema and the
services but no seeded tasks — nothing about the design is higher-education-specific, so
turning it on there later is seed data, not code.

**Two pure modules**, 72 tests:

- `src/lib/domain/org.ts` — subordinate resolution, manager chain, cycle prevention, org-unit
  forest. Every traversal is iterative and cycle-guarded, because `managerId` is editable
  through a form and two individually-reasonable edits produce a loop.
- `src/lib/domain/tasks.ts` — lateness, escalation, completion statistics, workload balance,
  visibility predicates, ordering.

**The decisions worth recording** (all in [ALGORITHMS.md](ALGORITHMS.md) §18-22):

| Decision | Why the obvious alternative is wrong |
|---|---|
| SUBMITTED is a distinct state from COMPLETED | Otherwise "the lecturer says they submitted grades" and "grades are in" are the same fact, and a dean's dashboard reports intentions |
| Only the **assigner** may accept | An assignee accepting their own work makes SUBMITTED decorative |
| "is overdue" ≠ "was late" | Listing finished-but-late work as overdue sends someone to chase a completed task |
| Cancelled work leaves the completion denominator | Otherwise a manager can depress a subordinate's numbers by raising and dropping tasks |
| Empty denominators return `null`, not `0` | 0% is a finding; null is the absence of one. Rendering an empty record as 0% puts a new lecturer on a watch list in their first week |
| Fair allocation ranks by **utilisation**, not raw load | A half-time lecturer at 6/9 hours is fuller than a professor at 9/18 |
| Escalation grace varies by priority, and fires **once** | One threshold for everything trains people to ignore the notification |
| Visibility is a **relationship** predicate, not a role | "A dean may see a lecturer's task" is a fact about the reporting line; it cannot live in `rbac.ts` |

**Managers can see but not edit.** A dean who can follow a lecturer's whole queue should not be
silently editing items in it — the visible act of reassigning is what makes the hierarchy
legible to the person being managed.

**Allocating a section raises TWO tasks**, not one: teaching (due at term start) and grade
submission (due a fortnight after term ends). They have different deadlines and get chased at
different points; collapsing them means the teaching task sits open for four months telling
nobody anything.

**Reallocating supersedes rather than deletes.** The previous holder's open tasks are cancelled
so they leave that person's queue, but the history stays — a dean investigating a section that
went wrong needs to know it was once asked of someone else.

**Verified live**, production build, seven minted sessions across both universities:

| Check | Result |
|---|---|
| Transitive team resolution | Dean sees 3 (1 direct + 2 marked *indirect*); the HOD between them sees 2; Meridian's HOD sees 1 |
| A lecturer with no reports | Gets an explanation panel, not a 403 — having no subordinates is ordinary |
| Record-level visibility | Assignee ✓, their manager ✓, dean two levels up ✓, unrelated peer **404**, registrar (blanket grant) ✓ |
| Cross-school isolation | Prof. Okafor's Golden Eagles queue holds CSC/MTH/EEE sections; her Meridian queue holds only DAT201-A. Her GEU session **404s** on a Meridian task |
| Accept permission | The assignee sees no "Accept as complete" and is told why; the dean who raised it does; the manager in between can see the task but not change it |
| Escalation fan-out | 12 escalations → 22 notifications: assignee plus manager, except the 2 tasks belonging to the Dean, who has nobody above them |
| Workload imbalance | Correctly flags "Balogun is carrying 67% while Eze is at 22%", spread 44 points, against per-rank ceilings |

**Defect found and fixed — in the seed, not the code.** Two of the four dashboard figures read
0% and 0d. Both were arithmetically correct: every seeded task was created and completed in the
same instant, so turnaround was genuinely zero and every past deadline was genuinely missed. The
seed now backdates completed work so both branches of the lateness rule are exercised — on-time
delivery reads 75%, turnaround 20.3 days. A seed that makes correct software look broken is
worse than no seed.

**Known modelling wrinkle, deliberately left:** a "Teach CSC201-B" task due at term start shows
as overdue two weeks into term for a lecturer who is plainly teaching it. That is the rule
working — the task means *confirm you have picked this up by term start* — but the wording
invites the wrong reading. Worth revisiting when the task templates are made configurable.

**Not exercised end-to-end:** the form submissions (raise, transition, comment, reassign,
allocate) run through their services — the seed calls `createTask`, `transitionTask` and
`allocateSection` directly — but were not posted through the rendered HTML forms, which need a
live Next.js server-action handshake.

282 tests green · `tsc --noEmit` clean · production build clean.


---

## Phase 4 — Forums ✅

`Forum` (audience: STAFF | STUDENT), `ForumCategory`, `Thread`, `Post`, `PostReaction`, `PostReport`.

Pure `src/lib/domain/forum.ts`: thread ranking (hot/new/top, pinned always floating, deterministic tie-break), post rate-limiting, a moderation reducer, mention extraction, pagination.

Service concerns: permission checks, denormalised `postCount`/`lastPostAt` maintained inside the write transaction (the existing `seatsTaken` pattern), report-a-post creating a moderator **task**, replies and mentions creating **notifications**.

**Security** — markdown is an XSS surface. Sanitise, disallow raw HTML, and add a real Content-Security-Policy to `next.config.mjs`, which currently sets only the basic headers.

### What shipped, and what was verified

**The security work came first**, because forums are the first place in this system where one
user's text renders in another user's browser.

**`src/lib/domain/markdown.ts` — escape-first, not parse-then-sanitise.** Every `& < > " '` in
the source becomes an entity BEFORE any transform runs, so after that step the string is inert
and every tag in the output is one this codebase wrote. A bug here produces ugly output, not
script execution. The alternative — a full parser plus a sanitiser — is only as good as the
sanitiser's next CVE.

The one vector escaping does not close is the link, since `javascript:alert(1)` contains no
markup. Schemes are allowlisted; `data:` is refused alongside `javascript:` (a
`data:text/html` URL executes in the document's origin and is the more often forgotten of the
two); internal whitespace is refused outright, because a browser strips the tab out of
`java<TAB>script:` before resolving the scheme.

**Content-Security-Policy shipped** in `next.config.mjs` — the item this phase owed.
`object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`,
and `connect-src 'self'` so injected script could not exfiltrate even if it ran. Dev gets
`'unsafe-eval'` and a websocket for Fast Refresh; production does not.

> **Owed, and stated rather than papered over:** `script-src` still carries
> `'unsafe-inline'`, because Next.js App Router streams RSC payloads through inline
> `<script>` tags and hydration breaks without it. The fix is per-request nonces generated in
> middleware and threaded through the document — a change to every rendered page, not a config
> line. Recorded as a known gap.

**Two pure modules, 97 tests:**

- `markdown.ts` (50 tests) — 12 XSS payloads asserted against a **tag allowlist** rather than a
  string blocklist, plus scheme validation and the block/inline grammar.
- `forum.ts` (47 tests) — hot ranking, rate limiting, the moderation reducer, audience
  visibility, the edit window, pagination.

**Decisions worth recording** (ALGORITHMS.md §23-26):

| Decision | Why |
|---|---|
| Store markdown **source**, never rendered HTML | Storing HTML freezes today's renderer into the database: a sanitiser fix would not reach a single existing post. Rendering on read means one code change protects the whole archive |
| Auto-hide at 5 reports, never auto-delete | Automatic deletion on a report count is how a coordinated group silences someone; a unique (post, reporter) constraint stops one objector reaching the threshold alone |
| DELETED is terminal | Restoring lets one moderator silently undo another's decision |
| Hiding does not clear the report count | It is evidence about how content was received, not a queue counter |
| Hot decays as `engagement / (age+2)^1.5` | Without decay the front page ossifies around whatever went viral in first term |
| Mentions render as markers, never links | A link built from unverified text advertises whether an account exists |
| 30-minute author edit window | Silently rewriting a post people already replied to misrepresents them |
| Reports raise a **task**, not a separate inbox | One queue a moderator watches, not two |

**Verified live**, production build, five sessions across both universities:

| Check | Result |
|---|---|
| **XSS, end to end** | Six payloads written straight into the database and served through the real page: **0 disallowed tags, 0 event-handler attributes**, and the single anchor emitted was the legitimate `https` link with `rel="noopener noreferrer nofollow"`. The `javascript:` link rendered as literal text |
| Audience isolation | A student reaching `/forums/staff-room` gets **404**, and the Staff Room does not appear on their index at all — the filter runs in the service, so it never reaches their process |
| Cross-school | A Meridian student sees only Meridian forums and threads |
| Moderator view | The registrar sees the reported essay-mill thread and its report count; the report raised a MODERATION task automatically |
| Mention fan-out | Prof. Okafor received a **GEU** notification for the GEU thread and a **separate MIT** notification for the MIT thread — per-membership, not per-user |
| Markdown grammar | Bullets, numbered lists, bold, fenced code and mentions all render; `###` maps to `<h4>` and **no author-emitted `<h1>`/`<h2>`** reaches the page, so the heading outline survives for screen readers |
| CSP | Present on every response; production policy carries no `unsafe-eval` |

**Defect found and fixed during the phase:** my first XSS assertions searched the whole output
for `onerror=`, which fails on `&lt;img onerror=…&gt;` — inert paragraph text. The
assertion was wrong, not the renderer. Replaced with a tag-allowlist check over the actual
emitted markup, which is both correct and strictly stronger.

379 tests green · `tsc --noEmit` clean · production build clean.


---

## Phase 5 — Digital resource library

Scoped to digital only per your decision — no copies, loans, due dates, reservations, or fines.

`LibraryResource` (title, authors, kind: EBOOK/DOCUMENT/LINK/VIDEO/AUDIO, url or file, subjects, year-group/program targeting, visibility), `ResourceCollection`, `ResourceView` (access tracking).

Access control by role, year group, and program. Search and subject-tag filtering. Usage analytics for librarians and heads of department. Requires the file-storage layer (below).

---

## Phase 6 — UI system pass

Realise the design canvas across the whole app. Full sidebar/top-bar/command-palette/breadcrumbs, `⌘K` global search, expanded `src/components/ui` (Dialog, DropdownMenu, Tabs, Toast, Avatar, DataTable, RichText, Combobox, Skeleton, extracted Pagination), dashboards built with the `dataviz` skill, dark mode, accessibility audit, and migration of every legacy page off the old `AppShell`.

---

## Cross-cutting work, slotted where first needed

| Item | Phase | Why |
|---|---|---|
| **File storage** (local disk dev / S3-compatible prod) | 1 | School logos; then resources, avatars, attachments, imports |
| **Per-school timezone helper** | 0 | `Meeting` minutes are institution-local; `Term` dates are UTC; services call server-local `new Date()`. Multi-tenant makes this load-bearing |
| **Bulk CSV import/export** | 1 | Onboarding a real school by hand is impractical |
| **Content-Security-Policy** | 4 | Forum markdown |
| **Rate limiting** | 4 | Public apply endpoint and forum posting |
| **Email/SMS channel** | 3 | Task escalation is meaningless if it is in-app only |
| **Saved/scheduled reports** | 3 | "Dean generates reports" implies export and scheduling |
| **i18n / locale formatting** | 6 | National vs international schools |

**Deferred, deliberately:** attendance beyond the K-12 basics, full timetable generation, gradebook depth (assignments, weighted categories, rubrics), messaging/DMs, calendar with iCal, payment gateway, financial aid, discipline and health records, per-tenant compliance export.

---

## Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| **Cross-tenant data leak** | Critical | Postgres RLS as the real guarantee; extension as defence in depth; `NOT NULL schoolId` fails closed; full cross-tenant test matrix |
| Prisma extension gaps (nested writes, `connect`, raw SQL) | High | Explicit `schoolId` in services; no raw SQL; RLS backstop |
| Interactive `$transaction` losing tenant scope | High | Every service body runs in one — pin the Prisma version and add a regression test asserting the callback client stays scoped |
| Config refactor breaking 128 tests | Medium | Optional params defaulting to today's constants; mechanical fixture updates |
| K-12 + higher-ed doubling the model | Medium | `academicModel` switch; K-12 gets its own module and routes rather than overloading university concepts |
| Doc-number collisions across tenants | Medium | `School.code` prefix + scoped count; unique constraint turns a race into a retry |
| Scope | High | Seven phases, each shippable; no phase starts before its dependency is green |
