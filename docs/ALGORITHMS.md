# Algorithm Specification
## Golden Eagles University SIS

Every algorithm below is implemented as a **pure function** — no I/O, no clock, no database.
That is not stylistic. These are the calculations that determine whether someone graduates,
what they owe, and whether they are admitted. They must be reproducible from their inputs
alone, reviewable against the academic regulations without a running system, and testable
without a fixture database.

Persistence wraps them; it never mixes with them.

```
src/lib/domain/     pure decisions      ← this document
src/server/         transactions, I/O   ← wraps them
```

**Index**

| # | Algorithm | Module | Complexity |
|---|---|---|---|
| 1 | Credit-weighted GPA | `grading.ts` | O(n) |
| 2 | Best-attempt repeat selection | `grading.ts` | O(n) |
| 3 | Academic standing cascade | `grading.ts` | O(1) |
| 4 | Graduation audit | `grading.ts` | O(\|core\|) |
| 5 | Timetable conflict detection | `enrollment.ts` | O(n + m·k) |
| 6 | Prerequisite satisfaction | `enrollment.ts` | O(p) |
| 7 | Enrollment eligibility pipeline | `enrollment.ts` | O(p + m·k) |
| 8 | Waitlist promotion & compaction | `enrollment.ts` | O(n log n) |
| 9 | Seat allocation under concurrency | `enrollment.service.ts` | O(1) writes |
| 10 | Weighted composite with renormalisation | `admissions.ts` | O(1) |
| 11 | Multi-reviewer aggregation | `admissions.ts` | O(r) |
| 12 | Rank-and-fill cohort allocation | `admissions.ts` | O(n log n) |
| 13 | Fee structure resolution | `finance.ts` | O(n) |
| 14 | Term fee assessment | `finance.ts` | O(i + d) |
| 15 | Oldest-due-first payment allocation | `finance.ts` | O(n log n) |
| 16 | Receivables ageing | `finance.ts` | O(n) |
| 17 | Lossless money splitting | `money.ts` | O(parts) |

---

## 1. Credit-weighted GPA

**Problem.** Reduce a set of graded attempts to a single number in [0.00, 4.00].

```
INPUT   E = [(credits_i, gradePoint_i)]
OUTPUT  gpa ∈ [0.00, 4.00]

  qualityPoints ← Σ credits_i · gradePoint_i    for i where gradePoint_i ≠ null
  gpaCredits    ← Σ credits_i                   for i where gradePoint_i ≠ null
  gpa           ← gpaCredits = 0 ? 0 : qualityPoints / gpaCredits
```

**O(n) time, O(1) space.**

Three policy decisions are made explicit here rather than buried in a query:

| Notation | Numerator | Denominator | Rationale |
|---|---|---|---|
| `A`–`E` | credits × point | credits | Normal case |
| `F` | **0** | **credits** | A failure *must* depress the GPA |
| `W` | excluded | **excluded** | A withdrawal cannot lower a GPA |
| `I`, `AU` | excluded | excluded | Not yet assessed / not for credit |
| `P` | excluded | excluded | Earns credit, does not move the GPA |

**Why `F` and `W` must differ.** If a withdrawal consumed denominator credits it would be
numerically identical to a failure — and the incentive to withdraw properly, through the
registrar, would vanish. Conversely, if a failure were excluded from the denominator, failing
would be free. The asymmetry is the point.

**Why the mean of course grades is wrong.** A 4-credit A and a 1-credit F:

```
  naive mean:      (4.0 + 0.0) / 2                   = 2.00   ✗
  credit-weighted: (4·4.0 + 1·0.0) / (4 + 1)         = 3.20   ✓
```

Averaging course grades silently equal-weights a one-credit seminar with a four-credit core
course. Over a degree the error is large and always in an arbitrary direction.

**Rounding.** Applied once, at the end, half-up with an epsilon correction:

```ts
Math.round((value + Number.EPSILON) * 100) / 100
```

Without the nudge, `1.005` — stored as `1.00499999999999989` — rounds *down* to `1.00`. On a
grade boundary that is a whole letter grade. Intermediate values are never rounded: rounding
per-term GPAs and then averaging them is a common shortcut that silently equal-weights terms
of unequal credit load.

---

## 2. Best-attempt repeat selection

**Problem.** A course taken more than once must contribute exactly once to the CGPA.

```
INPUT   attempts (may contain several per courseId)
OUTPUT  counted (one per courseId), superseded (the rest)

  best ← empty map keyed by courseId
  for a in attempts:
      incumbent ← best[a.courseId]
      if incumbent is null:      best[a.courseId] ← a
      else if WINS(a, incumbent): best[a.courseId] ← a;  superseded += incumbent
      else:                                              superseded += a

  WINS(c, i):
      c graded, i ungraded          → true
      c ungraded, i graded          → false
      both ungraded                 → c.term > i.term
      c.point > i.point             → true
      c.point < i.point             → false
      otherwise (tie)               → c.term > i.term
```

**O(n) time** — one pass, hash-map lookup.

**The subtle case.** An *ungraded* retake must never beat a graded attempt. Without that
clause, a student who registers to retake a course they already passed would see their CGPA
drop the instant registration completed, and recover only when the retake was graded. The
guard is one line; the bug it prevents generates support tickets every single term.

**Tie-breaking to the later term** keeps the transcript chronologically coherent: if a student
retakes and matches their prior grade, the visible attempt is the recent one.

**Term GPA does *not* apply this policy.** A term's GPA reports what happened in that term, as
recorded. Only the CGPA collapses repeats. This is why `computeGpa` takes an
`applyRepeatPolicy` flag rather than assuming.

---

## 3. Academic standing cascade

```
INPUT   cgpa, termGpa, creditsThisTerm, consecutiveProbationTerms, isFirstTerm
OUTPUT  standing, reason, requiresReview

  1.  isFirstTerm ∧ cgpa ≥ 1.0   → GOOD          (grace term)
  2.  cgpa < 1.0                 → DISMISSED     requiresReview = true
  3.  cgpa < 1.5                 → PROBATION
         ∧ consecutiveProbation ≥ 2 → DISMISSED  requiresReview = true
  4.  cgpa < 2.0                 → WARNING
  5.  cgpa ≥ 3.5 ∧ termGpa ≥ 3.5
         ∧ creditsThisTerm ≥ 12  → DEANS_LIST
  6.  otherwise                  → GOOD
```

**O(1).**

**Order is load-bearing.** Dismissal is tested before probation, probation before warning. A
guard-clause cascade evaluated in strict priority order makes it impossible for a student to
be assigned a more favourable standing than their worst qualifying condition. Reordering these
clauses is a correctness bug, not a refactor.

**The first-term shield has a floor.** Rule 1 requires `cgpa ≥ 1.0`. A first-term student below
the dismissal floor is *not* shielded — a grace term forgives a weak start, not a total one.

**Dismissal is never automatic.** `requiresReview` forces a human decision, and
`recomputeStudentAcademics` writes `DISMISSED` to the immutable term snapshot while holding the
*live* record at `PROBATION`. Expelling someone as a side effect of a floating-point comparison
is exactly the kind of thing that ends up in litigation.

---

## 4. Graduation audit

```
INPUT   creditsEarned, creditsRequired, cgpa, minCgpa,
        requiredCoreCourseIds, passedCourseIds, hasBlockingHold
OUTPUT  eligible, creditsRemaining, missingCore, classification, blockers[]

  passed  ← Set(passedCourseIds)               O(|passed|)
  missing ← [c ∈ core : c ∉ passed]            O(|core|), O(1) per lookup
  blockers ← accumulate every unmet condition
  eligible ← blockers = ∅
```

**O(|core| + |passed|)** — the `Set` turns what a nested scan would make O(|core|·|passed|)
into a linear pass.

Every unmet condition is accumulated. A student is told everything standing between them and
graduation at once, rather than discovering one blocker per visit.

---

## 5. Timetable conflict detection

**The interval predicate.** Two half-open intervals `[aStart, aEnd)` and `[bStart, bEnd)`
overlap iff:

```
  aStart < bEnd  ∧  bStart < aEnd
```

**Half-open is mandatory.** A class ending at 10:00 and one starting at 10:00 do **not**
conflict. With closed intervals the system would reject every back-to-back timetable the
registrar builds — which is most of them.

```
INPUT   existing (registered sections + meetings), candidate
OUTPUT  conflicts [{ day, existingOffering, candidateOffering, overlapMinutes }]

  byDay ← bucket every existing meeting by dayOfWeek       O(n)
  for slot in candidate.meetings:                          O(m)
      for other in byDay[slot.dayOfWeek]:                  O(k)
          if OVERLAP(slot, other): record conflict
```

**O(n + m·k)** versus the naive O(n·m), where k is meetings-per-weekday (typically 2–4).

At realistic scale the performance difference is irrelevant — a student registers for at most
eight courses. The bucketing earns its place because it makes the conflict *report* naturally
grouped by day, which is the shape the UI needs.

**Times are integer minutes from midnight.** No timezone arithmetic, no DST, no date objects
in the hot path — conflict detection is pure integer comparison and cannot drift.

---

## 6. Prerequisite satisfaction

The curriculum is a **DAG** whose edges are prerequisites.

```
INPUT   rules (immediate in-edges), completed, concurrentlyRegistered
OUTPUT  satisfied, unmet[]

  best ← map courseId → max(gradePoint)         O(|completed|)
  for rule in rules:                            O(p)
      if best[rule.prereq] ≥ rule.minGradePoint:      continue   ✓
      if rule.isConcurrent ∧ rule.prereq ∈ concurrent: continue  ✓
      unmet += descriptive reason
```

**O(p + |completed|).**

**Only immediate prerequisites are checked — the graph is never walked.** Transitive
prerequisites are satisfied by induction: a student could not have passed CSC201 without
having satisfied CSC201's own prerequisites. A single-level check is therefore both correct
*and* linear. Walking the graph would be slower and would produce identical answers.

**`best` uses the maximum grade point**, so a successful retake unlocks downstream courses —
matching the best-attempt policy in §2. Using the most recent grade instead would let a
student lock themselves out of a course by retaking a prerequisite and doing worse.

---

## 7. Enrollment eligibility pipeline

The most consequential decision in the system.

```
INPUT   now, term, student, offering, holds, balance,
        prerequisites, history, existingRegistrations, alreadyEnrolled
OUTPUT  outcome ∈ {REGISTERED, WAITLISTED, REJECTED}, reasons[], waitlistPosition

  PHASE 1 — HARD RULES (accumulate all failures)
    R1  already enrolled                 → immediate REJECT
    R2  outside registration window
    R3  offering not OPEN
    R4  student status not registrable / under dismissal
    R5  any blocking hold
    R6  outstanding balance > tolerance
    R7  unmet prerequisites
    R8  timetable conflict
    R9  credit ceiling exceeded

    if reasons ≠ ∅ → REJECTED with ALL reasons

  PHASE 2 — CAPACITY (only reachable if every hard rule passed)
    seatsTaken < capacity                 → REGISTERED
    waitlistLength < waitlistCapacity     → WAITLISTED at position n+1
    otherwise                             → REJECTED (section and queue full)
```

**O(p + m·k)**; every rule except prerequisites and conflicts is O(1).

**Two ordering decisions matter:**

1. **Hard rules accumulate rather than short-circuit.** A student with three problems is told
   all three, instead of fixing one, resubmitting, and discovering the next. (R1 is the
   exception — a duplicate registration makes every other check meaningless.)

2. **Capacity is evaluated last.** A student who would be rejected anyway must never consume
   a seat or a waitlist place. Checking capacity first would let an ineligible student
   displace an eligible one from the queue.

---

## 8. Waitlist promotion and compaction

```
INPUT   queue, freedSeats
OUTPUT  promote[], renumbered[]

  ordered   ← sort queue by waitlistPosition ascending     O(n log n)
  promote   ← ordered[0 .. freedSeats)
  remaining ← ordered[freedSeats ..]
  renumbered ← remaining[i] ↦ position i+1                 O(n)
```

**O(n log n)**, n bounded by `waitlistCapacity` (typically ≤ 20).

**Compaction is not cosmetic.** Students are shown "you are number 4". If promotion left holes
(1, 3, 4, …) that number would be a lie, and the next promotion would appear to skip someone.
Dense positions are what make the displayed number meaningful.

`freedSeats > 1` handles batch drops — a cancelled cohort, a bulk administrative withdrawal.

---

## 9. Seat allocation under concurrency

The classic lost-update race:

```
  T1: read seatsTaken = 49  (capacity 50)   ┐
  T2: read seatsTaken = 49                  │  both observe a free seat
  T1: write seatsTaken = 50                 │
  T2: write seatsTaken = 50                 ┘  51 students, 50 seats
```

**Three layers of defence:**

**(a) One interactive transaction.** Read, decide, and write occur inside a single
transaction, so the snapshot cannot shift under the decision.

**(b) Conditional update — optimistic concurrency control.**

```sql
UPDATE course_offerings
   SET seatsTaken = seatsTaken + 1
 WHERE id = ? AND seatsTaken < capacity;
-- rowsAffected = 0  ⟹  another transaction took the seat first
```

This is the layer that actually holds under Postgres `READ COMMITTED`, where transaction
isolation alone would not prevent the race. A zero-row result is *detected* and reported —
"the last seat was taken moments ago; try the waitlist" — rather than silently overselling.

**(c) `UNIQUE(studentId, offeringId)`.** Makes double registration impossible at the storage
layer regardless of application bugs. A `P2002` violation becomes a friendly message.

**On the denormalised counter.** `seatsTaken` is a *cache*; the truth is
`COUNT(enrollments WHERE status='REGISTERED')`. The cache exists only because layer (b) needs
a single column to test atomically. `reconcileSeatCounts()` re-derives it and repairs drift —
and a non-empty result is a bug report, not routine maintenance.

---

## 10. Weighted composite with renormalisation

```
INPUT   five component scores, each ∈ [0,100] or null
OUTPUT  composite ∈ [0,100], breakdown[], missingComponents[], coverage

  weightedSum ← 0 ;  coverage ← 0
  for (component, weight) in WEIGHTS:
      if score is null: missing += component ; continue
      raw ← clamp(score, 0, 100)
      weightedSum += weight · raw
      coverage    += weight

  composite ← coverage = 0 ? 0 : weightedSum / coverage
```

**O(1)** — five fixed components.

| Component | Weight |
|---|---|
| Prior academic performance | 0.40 |
| Entrance examination | 0.30 |
| Personal statement | 0.15 |
| Interview | 0.10 |
| Extracurricular | 0.05 |

Weights sum to exactly 1.0, asserted at module load by `assertWeightsSumToOne()`.

**The denominator is the entire algorithm.** A naive implementation treats a missing component
as zero:

```
  applicant scores 90 on both academic components, not yet interviewed

  missing-as-zero:  0.40·90 + 0.30·90 + 0.15·0 + 0.10·0 + 0.05·0  = 63.0   ✗
  renormalised:    (0.40·90 + 0.30·90) / (0.40 + 0.30)            = 90.0   ✓
```

A 27-point penalty for an administrative gap. Renormalising answers the honest question:
*given what we know, how does this applicant score?*

**`coverage` is returned so the caller can refuse to decide on thin evidence.** A composite
built from 45% of the rubric is a number, not a judgement — §12 screens on exactly this.

---

## 11. Multi-reviewer aggregation

```
INPUT   reviews[]
OUTPUT  per-dimension means, disagreementSpread, requiresAdjudication, consensus

  1. mean each dimension independently, skipping nulls per dimension   O(r)
  2. spread ← max(academic) − min(academic)
     requiresAdjudication ← spread > 20
  3. consensus ← mode(recommendations)
     ties break conservatively:  REJECT > WAITLIST > ADMIT
```

**O(r).**

**Per-dimension null skipping.** One reviewer who did not conduct an interview must not drag
the interview mean toward zero — their non-score simply is not in that average.

**Disagreement is surfaced, not averaged away.** Reviewers scoring 90 and 50 are not looking at
the same applicant, and their mean of 70 is a fiction that *looks* like consensus. Flagging for
a third adjudicating review is the only honest response. Averaging away genuine disagreement is
how bad admissions decisions get laundered into defensible-looking numbers.

**Conservative tie-breaking.** A split committee does not admit.

---

## 12. Rank-and-fill cohort allocation

The core admissions decision: given a scored pool and fixed capacity, produce a ranked,
fully-justified outcome for **every** applicant.

```
INPUT   pool, policy{capacity, waitlistCapacity, minComposite, minCoverage, requiredReviews}
OUTPUT  decisions[] — one per application, each with rank and rationale

  PHASE 1 — SCREEN                                          O(n)
    reviewCount < requiredReviews  → UNDER_REVIEW (not yet decidable)
    coverage    < minCoverage      → UNDER_REVIEW (insufficient evidence)
    composite   < minComposite     → REJECTED     (below the bar)
    otherwise                      → contender

  PHASE 2 — RANK                                            O(n log n)
    sort contenders by:
        composite    DESC
        coverage     DESC      ← better-evidenced application wins a tie
        submittedAt  ASC       ← rewards promptness; objective and defensible
        applicationId ASC      ← final determinism guarantee

  PHASE 3 — FILL                                            O(n)
    walk ranked list:
        seats remaining      → OFFERED
        waitlist remaining   → WAITLISTED
        otherwise            → REJECTED
```

**O(n log n) time, O(n) space.**

**The comparator must be a strict total order.** A comparator that can return `0` for distinct
applications makes the sort implementation-defined — the same pool can produce *different
admits on different runs*. That is indefensible if a decision is challenged, and it is why the
final tie-breaker is the application id: not because id order is meaningful, but because
*some* deterministic tie-breaker must exist.

**Verified by test:** the same pool in reversed order yields identical decisions.

**Every applicant receives a decision with a stored rationale**, including those screened out.
No one falls through a gap in the logic.

**Dry run is the default.** `runCohortAllocation({ dryRun: true })` computes the full outcome
without writing. The committee sees exactly who a policy admits *before* offers become real —
and because preview and commit call the identical pure function, the preview cannot diverge
from the outcome.

---

## 13. Fee structure resolution

Fee structures form an overlapping hierarchy. Exactly one must win, deterministically.

```
INPUT   candidates, context{termId, programId, level}
OUTPUT  the single most specific applicable structure, or null

  for c in candidates:
      skip if not active, or wrong term
      skip if c.programId set and ≠ context.programId    ← wrong price list, not a weaker match
      skip if c.level     set and ≠ context.level

      score ← (c.programId ≠ null ? 2 : 0) + (c.level ≠ null ? 1 : 0)
      keep the highest score
```

**O(n).**

| Score | Structure | Specificity |
|---|---|---|
| 3 | program + level | most specific |
| 2 | program only | |
| 1 | level only | |
| 0 | institution-wide default | fallback |

**The bitmask makes ties impossible** — every combination maps to a distinct score, so
resolution never depends on iteration order.

**A non-matching `programId` is discarded, not down-ranked.** An engineering fee structure is
not a weaker match for a computer science student; it is the *wrong price list*.

---

## 14. Term fee assessment

```
INPUT   items[], registeredCreditHours, discounts[]
OUTPUT  lines[], subtotal, discount, total          (all integer minor units)

  1. expand each item:
        perCreditHour → quantity = registeredCreditHours
        otherwise     → quantity = 1
        amount = quantity · unitAmount            (integer multiply — no rounding)

  2. subtotal ← Σ line amounts

  3. discounts, each against the ORIGINAL subtotal:
        flat    → += flatMinor
        percent → += round(subtotal · percent / 100)

  4. discount ← min(discount, subtotal)
     total    ← subtotal − discount
```

**O(items + discounts).**

**Percentages apply to the original subtotal, never sequentially.** Two 10% discounts must
total 20%:

```
  sequential:  100 → 90 → 81      ⟹ 19% given, 1% quietly overcharged
  against original: 100 − 10 − 10 = 80  ⟹ 20%   ✓
```

Sequential application is a classic bug: invisible in testing with one discount, materially
wrong at scale with two.

**The discount is clamped to the subtotal.** A discount can zero a bill; it can never make the
institution owe the student money. Credit balances arise from *overpayment* and are modelled
there (§15) — never manufactured by a discount.

---

## 15. Oldest-due-first payment allocation

A payment arrives without saying which invoice it settles.

```
INPUT   paymentAmount, openInvoices[]
OUTPUT  allocations[], unappliedMinor

  ordered ← sort by  dueDate ASC, issuedAt ASC, invoiceNo ASC     O(n log n)
  remaining ← paymentAmount

  for invoice in ordered:                                          O(n)
      break if remaining ≤ 0
      balance ← invoice.total − invoice.paid
      continue if balance ≤ 0
      applied ← min(remaining, balance)
      allocations += (invoice, applied)
      remaining  −= applied

  unapplied ← remaining          ← becomes student credit, never discarded
```

**O(n log n).**

**Why oldest-due-first**, rather than largest-first or newest-first: it is the only ordering
that reliably clears the invoice most likely to trigger a registration hold or a late penalty.
It is also the ordering a payer intuitively expects, which matters when explaining an
allocation to someone at the bursary counter.

**The three-key sort is a strict total order.** Two invoices sharing a due date is routine —
per-term tuition and a per-term hostel fee — so the tie-breakers are load-bearing, not
theoretical. Without them, the same payment against the same ledger could allocate differently
on different runs.

**Two invariants the walk preserves:**
- `applied = min(remaining, balance)` — an invoice is never over-applied
- residue becomes `unappliedMinor` — money is never silently discarded

**Idempotency.** `UNIQUE(payments.externalRef)` makes this path safe to expose to a payment
provider's webhook: a retried callback hits the constraint and is reported as
already-processed rather than crediting the student twice.

---

## 16. Receivables ageing

```
INPUT   invoices[], now
OUTPUT  { current, d1_30, d31_60, d61_90, d90_plus, total }

  for invoice in invoices:
      skip if voided or balance ≤ 0
      daysPastDue ← floor((now − dueDate) / 86_400_000)
      bucket[matching band] += balance
```

**O(n) single pass, O(1) space.**

**`floor` on whole milliseconds is deliberate.** An invoice due today is 0 days past due until
midnight tomorrow — the way a bursar counts. `ceil` or `round` would age every invoice a day
early and misstate the report to management.

---

## 17. Lossless money splitting

```
INPUT   total (minor units), parts
OUTPUT  parts amounts summing EXACTLY to total

  base      ← floor(total / parts)
  remainder ← total − base · parts
  distribute one extra minor unit to the first `remainder` parts
```

**O(parts).**

**Naive division loses money.** 100 kobo split three ways gives 33.33 each; truncating gives
33 + 33 + 33 = 99. One kobo has evaporated. Distributing the remainder one minor unit at a
time across the leading parts guarantees the parts sum exactly to the input — the standard
allocation algorithm for instalment plans.

**Verified by test** for every part count from 1 to 12 against a non-round total.

---

## 18. Subordinate resolution (iterative BFS)

```
INPUT   reporting edges[], rootMembershipId
OUTPUT  every membership below root, transitively

  childrenOf ← index edges by managerId
  visited    ← {}
  queue      ← childrenOf[root]

  while queue not empty:
      node ← queue.shift()
      skip if node ∈ visited        // diamond, or a cycle on its second lap
      skip if node = root           // a cycle through the root
      visited += node
      queue += childrenOf[node]
```

**O(V + E), one index build.** The recursive alternative costs a database round trip per level
of hierarchy and cannot detect a cycle without extra bookkeeping.

**`visited` is both the result and the cycle guard.** `Membership.managerId` is editable through
a form, so two individually-reasonable edits ("A reports to B", "B reports to A") produce a cycle.
An unguarded traversal of one hangs the request thread that finds it, turning a data-entry
mistake into an outage. Iterative rather than recursive for the same reason: a cycle would blow
the stack before any depth guard ran.

**The root is excluded from its own subordinate set**, or "show my team's tasks" would include
the manager's own queue.

---

## 19. Task lateness

```
INPUT   { status, dueAt, completedAt }, now
OUTPUT  { isOverdue, wasLate, daysLate, daysRemaining }

  if dueAt = null            -> neither         // an open-ended request cannot be missed
  if status = CANCELLED      -> neither         // withdrawn work was never owed
  if status is closed:
      at        ← completedAt ?? dueAt
      wasLate   ← at > dueAt
      isOverdue ← false
  else:
      isOverdue ← now > dueAt
      wasLate   ← false
```

**O(1).**

**"Is overdue" and "was late" are different facts.** A task completed two days after its deadline
is not overdue — there is nothing left to chase, and listing it under "overdue" sends someone to
ask about finished work. But it *was* late, and a term-end report that forgets that is flattering
rather than useful. So lateness is measured against `completedAt` once closed and against `now`
while open.

**A missing `completedAt` counts as on time.** Inferring "it must have been late" from a null
would put a mark against a person on the strength of absent data.

---

## 20. Completion statistics

```
completionRate = completed / (total − cancelled)
onTimeRate     = onTime    / (completed tasks that HAD a deadline)
```

**Both denominators are chosen against the obvious one.**

Cancelled tasks leave the completion denominator. Counting work against the person you withdrew
it from is indefensible, and it would let a manager depress a subordinate's numbers by raising
and dropping tasks.

Tasks with no deadline leave the on-time denominator. They cannot be late, so including them
inflates every rate towards 100% in proportion to how vague the assigner was.

**Both return `null`, not `0`, on an empty denominator.** Zero is a finding — "this person
delivers nothing on time". Null is the absence of one. Rendering an empty record as 0% puts a
new lecturer on a dean's watch list in their first week.

---

## 21. Fair teaching allocation (least-utilised-first)

```
INPUT   staff[] with { assignedUnits, capacityUnits, assignedItems, name }, units
OUTPUT  the staff member who should take the work, or null

  eligible ← staff where (capacityUnits − assignedUnits) ≥ units
  return null if eligible empty
  sort by utilisation asc, then assignedItems asc, then name asc
  return first
```

**O(n log n).**

**Ranks by utilisation, not raw load.** Raw load hands the next section to whoever teaches fewest
hours, which is wrong whenever contracts differ: a half-time lecturer at 6 of 9 hours is fuller
than a professor at 9 of 18, and the professor is the fair answer despite teaching more.

**Zero capacity means unavailable, not infinitely available** — utilisation is forced to 1 so
someone on leave is never proposed.

**Candidates without headroom are excluded, not sorted last.** This is a proposal, and proposing
work that breaks a contractual ceiling is worse than proposing nobody. An empty result means
"everyone is full", which is a real and actionable answer.

**Ties break deterministically** (fewer sections, then name). A suggestion that reshuffles between
two identical page loads is not one a dean will trust twice.

**It suggests; it never assigns.** Specialism, research leave and departmental politics are
invisible to the calculation, so the human stays in the loop by construction.

---

## 22. Escalation

```
INPUT   task, now, policy { graceDays per priority, remindBeforeDays }
OUTPUT  NONE | REMIND | ESCALATE

  closed or no deadline                    -> NONE
  overdue and alreadyEscalated             -> NONE
  overdue by ≥ graceDays[priority]         -> ESCALATE   (tell the manager)
  due within remindBeforeDays              -> REMIND     (tell the assignee)
  otherwise                                -> NONE
```

**O(1) per task; the sweep is O(n) over open tasks with a deadline.**

**The grace gradient is the point** — URGENT 0 days, HIGH 1, NORMAL 3, LOW 7. Escalating
everything at one threshold trains a dean to ignore the notification entirely.

**`escalatedAt` makes the sweep idempotent.** A task that escalates once an hour until someone
acts is one everyone filters out of their inbox, and the signal becomes worth less than silence.
Reminders are deliberately allowed to repeat; escalations are not.


## 23. Escape-first markdown rendering

```
INPUT   author's markdown source
OUTPUT  HTML safe to inject

  1. strip control characters
  2. escape & < > " '        <- string is now INERT
  3. apply block grammar     <- introduces only tags we write
  4. apply inline grammar    <- validates every URL against a scheme allowlist
```

**O(n) over the source.**

**The order is the security property.** The usual approach is parse-then-sanitise: run a full
markdown parser, let it emit whatever raw HTML the author wrote, then strip the dangerous parts.
That is sound only if the sanitiser is perfect, and sanitisers are perfect only until the next
mutation-XSS bug. It is a denylist wearing an allowlist's clothes.

Escaping first inverts it. After step 2 there is not a single `<` left in the string, so no
input character can become a tag delimiter. Every tag in the output is one this code wrote. The
failure mode of a bug becomes ugly output rather than script execution.

**The one vector escaping does not close is the link.** `javascript:alert(1)` contains no
markup, and it lands in an `href`. So schemes are allowlisted (`http`, `https`, `mailto`,
plus app-relative `/…`) and everything else renders as literal text. `data:` is refused
alongside `javascript:` — `data:text/html` executes in the document's origin and is the more
frequently forgotten of the two. Internal whitespace is refused outright, because a browser
strips the tab out of `java<TAB>script:` before resolving the scheme, and a naive prefix check
would see something harmless.

**Verified by injecting six live payloads** through the database into a rendered thread: zero
disallowed tags, zero event-handler attributes, and the only anchor emitted was the legitimate
`https` link.

---

## 24. Hot ranking (gravity decay)

```
score = (postCount + reactionCount) / (ageHours + 2) ^ 1.5
```

**O(n log n) to sort.**

**Why decay.** Without it "hot" means "most replies ever", and the front page ossifies around
whatever thread went viral in first term. A student arriving in March should see March.

**Why +2.** A thread minutes old would otherwise divide by near-zero and rocket to the top on one
reply. The offset flattens the first couple of hours so a thread earns its place.

**Why 1.5.** At 1.0 old popular threads linger for days; at 2.0 anything over a day is invisible,
which is wrong when a question may take a week to attract its best answer. 1.5 puts the half-life
near a day and a half. These are judgement calls, not physics — recorded so the next person
changes them knowingly.

**Pinned threads float in every mode**, and every comparison ends in an id tie-break so the order
is TOTAL — a list that reshuffles between identical page loads makes pagination skip and repeat
items, which reads as data loss.

---

## 25. Forum moderation reducer

A pure state transition over `{status, isPinned, reportCount}`.

**DELETED is terminal.** Nothing transitions out of it. Restoring deleted content would let one
moderator silently undo another's decision; if something must come back it is reposted, and the
record shows that.

**Hiding does not clear reports.** The count is evidence about how content was received, not a
queue counter to be zeroed — a moderator reviewing a repeat offender needs the history.

**Auto-hide is a threshold, never a verdict.** Five reports hide content *pending review*. It is
deliberately not deletion: automatic deletion on a report count is how a coordinated group
silences someone they disagree with. A unique constraint on (post, reporter) stops one objector
reaching the threshold alone.

---

## 26. Forum rate limiting

Three limits, because they catch different failures:

| Limit | Catches |
|---|---|
| 20s minimum gap | a double-submitted form, an angry back-and-forth |
| 30 posts/hour | a script |
| 10 new threads/day | thread spraying, which is worse than replies — each takes a front-page slot |

**Refusals say WHEN, not just no.** "Try again in 14 seconds" is actionable; "rate limited" makes
a person hammer the button. Timestamps come from the caller, which is what makes the policy
testable without waiting.


## Appendix A — Why money is never a float

```js
0.1 + 0.2 === 0.3        // false
0.1 + 0.2                // 0.30000000000000004
```

IEEE 754 cannot represent most decimal fractions exactly. Every arithmetic operation on a
float balance accumulates error. In a fee system this produces:

- balances that should be zero reading as `0.000001`, blocking registration over nothing
- reconciliation reports that never quite tie out
- audit findings that are individually trivial and collectively unexplainable

**The rule, enforced throughout:** parse to integer minor units at the boundary, store minor,
compute in minor, format only for display. `src/lib/domain/money.ts` is the only module that
converts, and `assertMinor()` throws on any non-integer that reaches it.

## Appendix B — Complexity summary

| Operation | Time | Bound in practice |
|---|---|---|
| GPA (one student) | O(n) | n ≈ 40 enrollments |
| Full academic recompute | O(n log n + n·t) | t ≈ 8 terms |
| Eligibility check | O(p + m·k) | p ≈ 3, m ≈ 3, k ≈ 4 |
| Waitlist promotion | O(n log n) | n ≤ waitlistCapacity ≈ 20 |
| Cohort allocation | O(n log n) | n ≈ 10³ applications |
| Payment allocation | O(n log n) | n ≈ 10 open invoices |
| Ageing report | O(n) | n = all invoices |

Nothing here is asymptotically threatening at institutional scale. The engineering risk in a
student information system is not throughput — it is **correctness under concurrency and
arithmetic**, which is where the design effort has gone.
