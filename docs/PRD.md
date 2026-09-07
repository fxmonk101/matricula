# Product Requirements Document
## Golden Eagles University — Student Information, Admissions & Finance System

| | |
|---|---|
| **Version** | 1.0 |
| **Status** | Implemented (Phase 1) |
| **Scope** | Identity & RBAC · Academic structure · Admissions · Registration & Assessment · Finance |
| **Out of scope (Phase 1)** | LMS/coursework delivery, HR & payroll, hostel, library, alumni, timetable auto-generation |

---

## 1. Problem statement

Universities do not fail at software because any single feature is hard. They fail because
**the same fact is recorded in several places and the copies disagree.**

The characteristic failure modes, in the order they cause damage:

1. **A student is billed twice for one term.** Two invoices exist because the assessment ran
   twice and nothing made the second run idempotent.
2. **A CGPA cannot be reproduced.** The stored number was incrementally updated over four
   years; nobody can say which enrollments produced it, and a challenged grade cannot be
   audited.
3. **A section oversells.** Two students take the last seat because capacity was read,
   then written, without either operation being atomic.
4. **A registration is blocked for a ₦1 rounding residue** — because money was stored as a
   float and a balance that should be zero is 0.000001.
5. **An admissions decision cannot be defended.** The ranking used a comparator that returns
   0 for distinct applicants, so the same pool produced different admits on different runs.

Every design decision in this document is traceable to preventing one of these five.

### 1.1 Guiding principles

| # | Principle | Consequence in the build |
|---|---|---|
| P1 | **One authoritative record per fact** | Derived values (CGPA, `paidMinor`, `seatsTaken`, invoice status) are caches, recomputed from source, never independently authored |
| P2 | **Decisions are pure; persistence is transactional** | Every algorithm is a pure function in `src/lib/domain/`; services in `src/server/` do I/O around them |
| P3 | **Money is integers** | All amounts are minor units (kobo). No float ever touches a balance |
| P4 | **Explain every refusal** | A rejected registration returns *all* failing rules, not the first |
| P5 | **Consequential actions are attributable** | Append-only audit log; holds and dismissals require a named officer |
| P6 | **Preview before commit** | Admissions allocation defaults to a dry run computed by the same code path that commits |

---

## 2. Users and their jobs

| Role | Primary job | Must never be able to |
|---|---|---|
| **Applicant** | Submit an application, track it, accept or decline an offer | See another applicant's file or their own committee scores |
| **Student** | Register for courses, see results, view and settle fees | Register while held; alter a grade; see another student's record |
| **Instructor** | Record and post grades for their own sections | Grade a section they do not teach; alter a posted grade unilaterally |
| **Admissions Officer** | Score applications against the rubric, run cohort allocation, issue decisions | Alter academic records or finance |
| **Registrar** | Own the academic record: structure, registration, standing, transcripts | Originate a grade; record a payment |
| **Finance Officer** | Assess fees, record payments, manage financial holds | Alter grades or academic standing |
| **Administrator** | System configuration, user management, audit | **Originate** a grade (may override, audited) |

> **Note on the administrator row.** `ADMIN` is deliberately *not* granted `grade:submit`. An
> administrator can override a grade — a deliberate, logged act — but cannot author one from
> nothing. Separating those two capabilities is what keeps the grade ledger trustworthy; an
> account that can silently mint grades makes every grade in the system unfalsifiable.

---

## 3. Functional requirements

### 3.1 Identity and access control

| ID | Requirement | Verification |
|---|---|---|
| FR-1.1 | Password authentication with bcrypt, cost ≥ 12 | `src/lib/auth/session.ts` |
| FR-1.2 | Sign-in failures return **one** generic message for unknown email, wrong password, and deactivated account | `signInAction` |
| FR-1.3 | A non-existent email costs approximately the same wall-clock time as a wrong password | `equaliseTiming()` against a dummy hash |
| FR-1.4 | Sessions are signed JWTs in `httpOnly`, `SameSite=Lax` cookies; `Secure` in production | `src/lib/auth/jwt.ts` |
| FR-1.5 | Refuses to start if `AUTH_SECRET` is shorter than 32 characters | `secretKey()` throws |
| FR-1.6 | Permissions are declared once as data, never as inline role comparisons | `ROLE_PERMISSIONS` matrix |
| FR-1.7 | Route authorisation in edge middleware **and** re-checked in every server action | `middleware.ts` + `requireRole()` |
| FR-1.8 | `?next=` redirect accepts relative paths only | Rejects `//evil.com` |

### 3.2 Academic structure

| ID | Requirement |
|---|---|
| FR-2.1 | Faculty → Department → Program → Course hierarchy |
| FR-2.2 | Prerequisites form a directed acyclic graph with a minimum grade point per edge |
| FR-2.3 | An edge may be marked **concurrent** (satisfiable in the same term) |
| FR-2.4 | A term carries four distinct dates: registration open/close, add-drop deadline, withdrawal deadline |
| FR-2.5 | Sections carry capacity, a bounded waitlist, and weekly meeting slots |
| FR-2.6 | Meeting times are integer minutes-from-midnight, making conflict detection exact integer arithmetic |

### 3.3 Admissions

| ID | Requirement |
|---|---|
| FR-3.1 | Public self-service application with account creation |
| FR-3.2 | Five-component weighted rubric; weights sum to exactly 1.0, asserted at module load |
| FR-3.3 | **A missing component is excluded, never scored as zero** — weights renormalise over available coverage |
| FR-3.4 | At least two independent reviews before any decision |
| FR-3.5 | Reviewer disagreement above 20 points flags for adjudication rather than averaging |
| FR-3.6 | Tied recommendations resolve conservatively (`REJECT` > `WAITLIST` > `ADMIT`) |
| FR-3.7 | Cohort allocation ranks under a **strict total order** and is deterministic |
| FR-3.8 | Allocation defaults to a dry run; committing is a separate, explicit action |
| FR-3.9 | Every decision carries a stated, stored rationale |
| FR-3.10 | Application lifecycle is an explicit state machine; illegal transitions throw |
| FR-3.11 | Offers expire; expiry is evaluated **lazily at read time**, never relying on a cron having run |
| FR-3.12 | Conversion to student (role change, matric number, student record, application closure) is one transaction |

### 3.4 Registration

| ID | Requirement |
|---|---|
| FR-4.1 | Eligibility evaluates nine hard rules before capacity is considered |
| FR-4.2 | **All** failing rules are returned, not the first |
| FR-4.3 | Capacity is evaluated last, so an ineligible student never consumes a seat or waitlist place |
| FR-4.4 | Seat claim uses a conditional update (`WHERE seatsTaken < capacity`), detecting a lost race rather than overselling |
| FR-4.5 | `UNIQUE(studentId, offeringId)` makes double-registration impossible at the storage layer |
| FR-4.6 | Waitlist is FIFO; positions are compacted on promotion so "you are number 4" stays true |
| FR-4.7 | Freeing a seat promotes from the waitlist **in the same transaction** |
| FR-4.8 | Drop vs. withdraw is determined by date: clean drop → no record; withdrawal → `W`; after deadline → denied |
| FR-4.9 | `reconcileSeatCounts()` repairs drift between the counter and the true registration count |

### 3.5 Assessment and the academic record

| ID | Requirement |
|---|---|
| FR-5.1 | Continuous assessment out of 40, examination out of 60; both range-validated |
| FR-5.2 | Grading scale is contiguous over [0, 100] with no gaps or overlaps, asserted programmatically |
| FR-5.3 | GPA is **credit-weighted**, never a mean of course grades |
| FR-5.4 | A withdrawal (`W`) is excluded from **both** numerator and denominator |
| FR-5.5 | A failure (`F`) earns 0 points but **does** consume denominator credits |
| FR-5.6 | Repeats use a **best-attempt** policy; superseded attempts stay on the transcript marked `R` |
| FR-5.7 | An in-progress retake never suppresses a prior passing grade |
| FR-5.8 | Term GPA counts every attempt as recorded; CGPA applies the repeat policy |
| FR-5.9 | CGPA is **fully recomputed**, never incrementally adjusted |
| FR-5.10 | Rounding is half-up with an epsilon correction, applied once at the end |
| FR-5.11 | Academic standing is a strict priority cascade; **dismissal is never applied automatically** |
| FR-5.12 | Posting grades requires a complete gradesheet; partial publication is refused |
| FR-5.13 | A blank score means "not assessed" and is skipped — never written as zero |
| FR-5.14 | Gradesheet saves are all-or-nothing, so a retry cannot double-write |

### 3.6 Finance

| ID | Requirement |
|---|---|
| FR-6.1 | All amounts are integer minor units |
| FR-6.2 | Fee structures resolve most-specific-first via a bitmask score; ties are impossible |
| FR-6.3 | Per-credit items bill against the student's **actual** registration |
| FR-6.4 | Stacked percentage discounts apply to the original subtotal, never compounded |
| FR-6.5 | Total discount is clamped to the subtotal; a bill can reach zero but never go negative |
| FR-6.6 | `UNIQUE(studentId, termId)` on invoices makes double-billing structurally impossible |
| FR-6.7 | Reassessment below the amount already paid is refused |
| FR-6.8 | Payments allocate oldest-due-first under a strict total order |
| FR-6.9 | Overpayment becomes an explicit credit balance; money is never discarded or over-applied |
| FR-6.10 | `UNIQUE(externalRef)` makes payment webhooks idempotent |
| FR-6.11 | Invoice status is **derived** from amounts and the clock, never independently set |
| FR-6.12 | Ageing buckets by whole elapsed days; an invoice due today is not yet overdue |
| FR-6.13 | Financial hold requires **both** a material overdue amount **and** the grace period passed |
| FR-6.14 | Settling an account releases its financial hold automatically; **placing** one never is |
| FR-6.15 | `reconcileInvoices()` re-derives `paidMinor` from allocation rows and reports drift |

---

## 4. Non-functional requirements

| Area | Requirement | How it is met |
|---|---|---|
| **Correctness** | Domain logic must be testable without a database | Pure functions in `src/lib/domain/`; 128 unit tests |
| **Auditability** | Every state change attributable to an actor | Append-only `audit_logs`; never updated or deleted |
| **Concurrency** | No oversold sections, no lost payments | Interactive transactions + conditional updates + unique constraints |
| **Integrity** | Derived values must be repairable | `reconcileSeatCounts`, `reconcileInvoices`, `recomputeStudentAcademics` |
| **Performance** | List pages must not degrade with enrolment | Filters pushed to SQL; pagination; independent aggregates run concurrently |
| **Security** | Defence in depth | Middleware **and** per-action checks; ownership verified per record, not per route |
| **Portability** | Dev on SQLite, production on Postgres | No engine-specific features; enums as strings validated by Zod |
| **Accessibility** | Keyboard and screen-reader usable | Semantic tables, labelled inputs, visible focus, ARIA on progress meters |

### 4.1 Deliberate trade-offs

| Decision | Cost accepted | Why |
|---|---|---|
| Full CGPA recompute instead of incremental | O(n) instead of O(1) per grade | An incremental total drifts irrecoverably; n ≈ 40, cost is milliseconds |
| Audit writes are non-throwing | A log line may be lost | A failed audit must not fail a legitimate payment. Move inside the transaction where a regulator requires guaranteed capture |
| Document numbers by counting rows | Collision possible under READ COMMITTED | `UNIQUE` turns a race into a retryable error, never a duplicate document. Replace with a sequence at high write volume |
| Denormalised `seatsTaken` | Can drift from truth | Needed for the conditional-update race guard; `reconcileSeatCounts` repairs it |
| Dismissal held at `PROBATION` on the live record | A dismissed student stays registrable until reviewed | Automating expulsion on a float comparison is indefensible |

---

## 5. Data model

18 entities. Full definitions in [`prisma/schema.prisma`](../prisma/schema.prisma).

```
Faculty ──< Department ──< Program ──< Student ──< Enrollment >── CourseOffering
                    │           │          │                            │
                    └──< Course │          ├──< Invoice ──< InvoiceLine │
                          │  │  │          │       │                    ├──< Meeting
                          │  │  └──< ProgramRequirement                 │
                          │  └──< Prerequisite (DAG, self-ref)          │
                          │                │       └──< PaymentAllocation >── Payment
                          │                │
User ──< Applicant ──< Application ──< ApplicationReview        Term ─┘
  │           │              └──< ApplicationDocument
  ├──< Instructor ─────────────────────────────────────────────────────┘
  └──< AuditLog                    Student ──< Hold, TermGpa
                                   Term ──< FeeStructure ──< FeeItem
```

**Constraints that carry correctness (not just tidiness):**

| Constraint | Prevents |
|---|---|
| `UNIQUE(students.matricNumber)` | Two students sharing an identity |
| `UNIQUE(enrollments.studentId, offeringId)` | Double registration |
| `UNIQUE(invoices.studentId, termId)` | **Double billing** |
| `UNIQUE(payments.externalRef)` | Double-crediting a retried webhook |
| `UNIQUE(course_offerings.courseId, termId, section)` | Duplicate sections |
| `UNIQUE(application_reviews.applicationId, reviewerId)` | One reviewer weighted twice in the mean |
| `UNIQUE(term_gpas.studentId, termId)` | Contradictory snapshots for one term |

---

## 6. Acceptance criteria

Verified by the automated suite (`npm test`, 128 assertions) and by live smoke testing.

**Grading**
- [x] A 4-credit A and a 1-credit F yield 3.20, not 2.00
- [x] Adding a `W` leaves the GPA unchanged
- [x] An `F` and a `W` produce *different* GPAs
- [x] `roundTo(1.005, 2) === 1.01` despite float representation
- [x] A retake with a better grade supersedes the earlier attempt; a worse one does not
- [x] An ungraded retake never suppresses a prior pass
- [x] Term GPA and CGPA differ correctly on a repeated course (2.00 vs 4.00)
- [x] Dean's List requires a full-time load
- [x] Dismissal always sets `requiresReview`

**Registration**
- [x] 09:00–10:00 and 10:00–11:00 do **not** conflict
- [x] A full section waitlists at the correct position; a full waitlist rejects
- [x] Waitlist positions compact to 1, 2, 3 after promotion
- [x] An ineligible student consumes no waitlist place
- [x] A successful retake unlocks a downstream course
- [x] Multiple failures are reported together

**Admissions**
- [x] Two components present out of five scores 90, not 63
- [x] The same pool in reversed order yields identical decisions
- [x] Composite ties break to the earlier submission
- [x] A split committee does not admit
- [x] `REJECTED → OFFERED` throws

**Finance**
- [x] `toMinor(0.1) + toMinor(0.2) === toMinor(0.3)`
- [x] 100 kobo split three ways sums to exactly 100
- [x] Two stacked 10% discounts total 20%, not 19%
- [x] A 100% discount plus a flat discount clamps to zero, never negative
- [x] Payment settles oldest-due first and is order-independent for same-day invoices
- [x] Overpayment becomes credit; no invoice is over-applied
- [x] An invoice due today is "not yet due"; a paid-but-late invoice reads `PAID`, not `OVERDUE`
- [x] A 3-day-late balance raises no hold; a 60-day-late one does

**Access control (live-verified)**
- [x] Unauthenticated `/dashboard` → `307 /login?next=%2Fdashboard`
- [x] Student → `/finance`, `/admin/audit` → `307 /forbidden`
- [x] Applicant → `/students` → `307 /forbidden`
- [x] Instructor → `/finance` → `307 /forbidden`
- [x] A tampered session cookie is treated as signed-out

---

## 7. Phase 2 backlog

Ordered by ratio of institutional value to implementation risk.

1. **Postgres migration** — one-line provider change; add connection pooling
2. **Payment gateway integration** — the idempotent `externalRef` webhook path already exists
3. **Transcript PDF generation** with institutional seal and verification code
4. **Timetable auto-generation** — graph colouring over the section/room/instructor conflict graph
5. **LMS**: assignments, submissions, continuous-assessment gradebook feeding `caScore`
6. **Scheduled jobs**: `expireStaleOffers`, `markOverdueInvoices`, `reconcile*` on a cron
7. **Email/SMS notifications** on decisions, holds, and registration windows
8. **Instalment plans** — `allocateEvenly()` already implements the lossless split
9. **Multi-factor authentication** for staff roles
10. **Analytics**: cohort retention, progression rates, collection forecasting
