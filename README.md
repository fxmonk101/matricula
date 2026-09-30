# School Platform — multi-tenant student information system

A multi-tenant school platform covering **admissions**, **student records**,
**registration & assessment**, and **finance** on one authoritative record —
with any number of schools on it, each configuring its own structure, grading
scheme, currency and branding.

Built with Next.js 15 (App Router, React 19), TypeScript, Prisma, and Tailwind CSS.

```
┌──────────────────────────────────────────────────────────────────┐
│  ADMISSIONS          REGISTRATION         BURSARY                │
│  ─────────────       ──────────────       ─────────              │
│  rubric scoring  →   eligibility rules →  fee assessment         │
│  reviewer panel      prerequisite DAG     payment allocation     │
│  rank-and-fill       seat + waitlist      receivables ageing     │
│         │                    │                   │               │
│         └────────────────────┴───────────────────┘               │
│                    ONE STUDENT RECORD                            │
│              GPA · standing · transcript · holds                 │
└──────────────────────────────────────────────────────────────────┘
```

---

## Quick start

```bash
npm install
npx prisma migrate dev               # creates the SQLite database
npm run db:seed                      # loads two demo schools
npm run dev                          # http://localhost:3000
```

Then sign in at [http://localhost:3000/login](http://localhost:3000/login).

> **The seed is for local demos only.** It empties the database first, and
> refuses to run on a remote database or on one holding real schools. To set up
> a real platform, run `npm run db:bootstrap` instead. See
> [docs/deploying.md](docs/deploying.md) §1.5.

### Demo accounts — password `Password123!`

The seed builds **two** schools, because a single tenant proves nothing about
isolation. Sign in at `/login` (routes you to your primary school) or at
`/s/<slug>/login` to pin one.

**Golden Eagles University** — `/s/golden-eagles/login` · Nigeria · NGN · 4.0 scale

| Email | Role | What to look at |
|---|---|---|
| `admin@geu.edu` | Administrator | Institution dashboard, audit log |
| `registrar@geu.edu` | Registrar | Student register, transcripts, standing |
| `admissions@geu.edu` | Admissions | Rubric reviews, cohort allocation (preview vs commit) |
| `bursary@geu.edu` | Finance | Receivables ageing, payment allocation, holds |
| `a.okafor@geu.edu` | Instructor | Gradesheet with live grade preview |
| `chidi.eze@student.geu.edu` | Student | Strong record — registration, transcript, fees |
| `kunle.adeoye@student.geu.edu` | Student | **Repeated course** — see the `R` marker on the transcript |
| `segun.okonkwo@student.geu.edu` | Student | **Probation + financial hold** — registration is blocked with reasons |
| `hopeful.golden-eagles@example.com` | Applicant | Application tracking and offer response |

**Meridian Institute of Technology** — `/s/meridian/login` · Ghana · GHS · **5.0 scale**

| Email | Role |
|---|---|
| `admin@meridian.edu.gh` | School administrator |
| `registrar@meridian.edu.gh` | Registrar |
| `ama.darko@student.meridian.edu.gh` | Student |

> **One identity, two schools.** `a.okafor@geu.edu` is a Dean at Golden Eagles
> *and* a visiting professor at Meridian — one user row, two memberships, a
> different role and a different dataset at each. Sign in through either school
> link to see the app change around you. That is why `User` carries no role.

### Things worth trying

1. **Sign in as `segun.okonkwo`** → *Registration*. Every section explains precisely why it is
   unavailable: the financial hold, the overdue balance, unmet prerequisites, timetable clashes.
2. **Sign in as `kunle.adeoye`** → *My Record*. His failed ACC101 attempt is on the transcript
   marked `R` and greyed out — retained for the record, excluded from the CGPA. The retake
   moved him from 0.83 to 1.72 and from dismissal territory to a warning.
3. **Sign in as `chidi.eze`** → *Registration* and try `CSC201-A`. It has three seats and all
   three are taken, so you are offered the **waitlist** at the correct position.
4. **Sign in as `admissions@geu.edu`** → run a cohort allocation. **Preview** first, expand the
   individual decisions to read each rationale, then commit. Both buttons run the identical
   algorithm.
5. **Sign in as `bursary@geu.edu`** → record a payment larger than the balance. Watch it
   allocate oldest-due-first and hold the excess as an explicit credit.

---

## Documentation

| Document | Contents |
|---|---|
| **[docs/PRD.md](docs/PRD.md)** | Product requirements — users, ~70 numbered functional requirements, data model, acceptance criteria, deliberate trade-offs |
| **[docs/ALGORITHMS.md](docs/ALGORITHMS.md)** | The 17 core algorithms in pseudocode with complexity analysis and the reasoning behind each design decision |

---

## Architecture

The central rule: **decisions are pure, persistence is transactional, and the two never mix.**

```
src/
├── lib/domain/          ← PURE. No I/O, no clock, no database.
│   ├── grading.ts          GPA, repeat policy, standing, graduation audit
│   ├── enrollment.ts       eligibility, conflicts, prerequisites, waitlist
│   ├── admissions.ts       composite scoring, review aggregation, rank-and-fill
│   ├── finance.ts          fee resolution, assessment, allocation, ageing
│   ├── money.ts            integer minor units — no floats, ever
│   └── enums.ts            single source of truth for every enumerated value
│
├── server/              ← TRANSACTIONS. Wraps the pure decisions in I/O.
│   ├── academics.ts        GPA recomputation (guard-free: the seed uses it too)
│   └── services/           enrollment, finance, admissions, audit, sequences
│
├── lib/tenant.ts        ← TENANT ISOLATION. dbFor(schoolId) — the cross-tenant guard.
├── server/tenant-context ← request-scoped school + scoped client (React-cached)
│
├── lib/auth/            ← jwt (edge-safe) · session (Node) · rbac (permission matrix)
├── app/                 ← routes, server actions, React Server Components
├── components/          ← design-system primitives
└── middleware.ts        ← edge route gating (defence in depth, not the boundary)

tests/                   ← 148 tests: 128 pure-domain + 20 cross-tenant isolation
prisma/                  ← schema + a seed that builds TWO schools through one function
```

**Why the split.** Eligibility rules change every academic session; the transaction that
persists an enrollment must never change. Keeping them in separate modules means the risky part
is a pure function you can test exhaustively without a fixture database, and the dangerous part
is small enough to review line by line.

---

## Correctness properties

These are the behaviours the system is built to guarantee. Each is covered by tests.

**Multi-tenancy** — every claim below is asserted in `tests/tenant.test.ts` and was re-verified in the running app
- One school can never read, update or delete another's rows; a cross-tenant `findUnique` returns `null` and a cross-tenant `update`/`delete` **throws**
- `schoolId` is `NOT NULL` on all 25 tenant tables, so a scoping failure fails closed rather than writing an unscoped row
- Tenant scoping survives into interactive transactions — where every service body runs
- The tenant-model registry is derived from the schema, so a new model is scoped the moment it exists
- Identity is global, authorisation per-school: one person can hold different roles at different schools
- Platform routes are gated on a platform claim, not a role — a school ADMIN cannot reach them

**Academic record**
- GPA is credit-weighted — a 4-credit A and a 1-credit F give 3.20, not 2.00
- A withdrawal (`W`) is excluded from both numerator and denominator and cannot lower a GPA
- A failure (`F`) *does* consume denominator credits, so failing and withdrawing differ
- Repeats keep the best attempt; an ungraded retake never suppresses a prior pass
- CGPA is fully recomputed, never incrementally adjusted — a running total drifts irrecoverably
- Dismissal is never applied automatically; it always requires registrar review

**Registration**
- Back-to-back classes (10:00 end, 10:00 start) do **not** conflict — intervals are half-open
- The last seat cannot be sold twice: interactive transaction + conditional update + unique constraint
- Every failing rule is reported at once, not one per attempt
- An ineligible student never consumes a seat or a waitlist place
- Waitlist positions stay dense, so "you are number 4" is true

**Admissions**
- A missing rubric component is excluded, not scored zero — 90 stays 90, it does not become 63
- Reviewer disagreement above 20 points is flagged, not averaged away
- Ranking uses a strict total order: the same pool in any order yields identical decisions
- Every decision carries a stored rationale
- Preview and commit run the identical function, so a preview cannot diverge from the outcome

**Finance**
- Money is integer minor units — `toMinor(0.1) + toMinor(0.2) === toMinor(0.3)`
- Splitting 100 kobo three ways sums to exactly 100
- Two stacked 10% discounts total 20%, not 19%
- `UNIQUE(studentId, termId)` makes double-billing structurally impossible
- Payments allocate oldest-due-first; overpayment becomes explicit credit, never discarded
- `UNIQUE(externalRef)` makes payment webhooks idempotent
- Invoice status is derived from amounts and the clock, never independently set

---

## Commands

```bash
npm run dev          # development server
npm run build        # production build (runs prisma generate first)
npm start            # serve the production build
npm test             # 128 unit tests over the domain layer
npm run typecheck    # tsc --noEmit
npm run db:migrate   # apply schema changes
npm run db:seed      # reload the demo institution
npm run db:studio    # browse the database
npm run db:reset     # drop, re-migrate, re-seed
```

---

## Moving to production

**1. Switch to PostgreSQL.** The schema deliberately avoids engine-specific features, so this
is a one-line change in `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"      // was "sqlite"
  url      = env("DATABASE_URL")
}
```

```bash
DATABASE_URL="postgresql://user:pass@host:5432/goldeneagles?schema=public"
npx prisma migrate deploy
```

**2. Generate a real `AUTH_SECRET`** (the app refuses to start below 32 characters):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

**3. Schedule the maintenance jobs.** All are idempotent and safe to run repeatedly:

| Job | Purpose | Suggested cadence |
|---|---|---|
| `expireStaleOffers()` | Lapse unaccepted offers | hourly |
| `markOverdueInvoices()` | Materialise the passage of time | daily |
| `reconcileInvoices()` | Re-derive `paidMinor` from allocations | daily |
| `reconcileSeatCounts()` | Repair `seatsTaken` drift | daily |

> A **non-empty** result from either `reconcile*` job is a bug report, not routine
> maintenance. It means a write path bypassed the service layer. Alert on it.

**4. Before going live**, review these known limitations:

- **Document numbering** counts existing rows inside the transaction. Correct under SQLite and
  Postgres `SERIALIZABLE`; under `READ COMMITTED` a collision is possible — the `UNIQUE`
  constraint turns it into a retryable error rather than a duplicate document, but at high
  write volume replace it with a Postgres `SEQUENCE`.
- **Audit writes are non-throwing** so a logging failure cannot fail a legitimate payment. Where
  a regulator requires guaranteed capture, move `recordAudit` inside the caller's transaction
  and remove the `catch`.
- **Application documents** store a `fileUrl` but no upload pipeline is wired up yet.
- **No rate limiting** on the login endpoint — add it at the edge or in front of the app.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15 · React 19 | Server Components and Server Actions keep data access on the server by default |
| Language | TypeScript (strict) | The domain layer is the specification; types enforce it |
| Database | Prisma 6 · SQLite → PostgreSQL | Zero-setup development, one-line path to production |
| Auth | `jose` JWT + `bcryptjs` (cost 12) | Edge-compatible verification; fewer moving parts than a framework |
| Styling | Tailwind CSS + hand-rolled primitives | No generator dependency, one consistent system |
| Validation | Zod at every trust boundary | Server actions never trust client input |
| Testing | Vitest | Fast, ESM-native, no database required for the domain layer |

---

## License

Prepared as a reference implementation. Adapt the academic regulations in
`src/lib/domain/` — grading scale, credit limits, standing thresholds, fee policy — to your
institution's published rules before any real use.
