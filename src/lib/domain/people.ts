import { ROLES, type Role } from './enums';
import { validateIdentifiers } from './identifier';

/**
 * =============================================================================
 * PEOPLE AND ACCOUNTS
 * =============================================================================
 *
 * Pure rules about who may act on whom, and what a person's account may look
 * like. No database, no session — so every rule here is testable in isolation,
 * which matters because these are the rules that decide whether an
 * administrator can lock the school's owner out of their own school.
 */

export class PeopleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PeopleError';
  }
}

// -----------------------------------------------------------------------------
// Seats and roles
// -----------------------------------------------------------------------------

/**
 * Roles a school administrator can hand out from the people console.
 *
 * OWNER is deliberately absent. An owner is created when the school is
 * provisioned, and transferring ownership is its own deliberate act with its
 * own confirmation — not an option in a dropdown next to "Librarian".
 *
 * APPLICANT is absent for a different reason: it is not granted, it is what
 * somebody becomes by applying, and the admissions flow owns it.
 */
export const ASSIGNABLE_ROLES: readonly Role[] = ROLES.filter(
  (r) => r !== 'OWNER' && r !== 'APPLICANT',
);

/**
 * Which roles count against which seat.
 *
 * A guardian is not a seat: a school is not billed for a parent reading their
 * child's report card, and billing them would make schools ration parent
 * accounts, which defeats the point of having a guardian portal. An applicant
 * is not a seat for the same reason — a school is not billed for people
 * applying to it.
 */
export function seatKindFor(role: Role): 'student' | 'staff' | null {
  if (role === 'STUDENT') return 'student';
  if (role === 'APPLICANT' || role === 'GUARDIAN') return null;
  return 'staff';
}

// -----------------------------------------------------------------------------
// Who may act on whom
// -----------------------------------------------------------------------------

export interface ActorContext {
  /** The acting person's role at this school. */
  role: Role;
  /** The acting person's own membership id, for the self-action rules. */
  membershipId: string;
}

export interface TargetContext {
  membershipId: string;
  role: Role;
}

/**
 * May `actor` change `target` at all?
 *
 * Three rules, and the reasoning for each matters more than the code:
 *
 * 1. **Only an OWNER may touch an OWNER.** Otherwise any administrator could
 *    suspend the owner, reset their password and take the school — and the
 *    owner is the one account with no higher authority inside the school to
 *    appeal to. This is a fact about the ROW being acted on, not about the
 *    actor's role, which is why it cannot live in the permission matrix.
 *
 * 2. **Nobody may suspend or demote themselves.** Not paternalism: an owner who
 *    demotes themselves by mis-clicking has created a school with no owner, and
 *    the only repair is a database console.
 *
 * 3. **Everything else needs the permission**, which the caller checks. This
 *    function answers the per-record question the matrix cannot.
 */
export function canActOn(
  actor: ActorContext,
  target: TargetContext,
  action: 'edit' | 'role' | 'suspend' | 'password' | 'delete',
): { allowed: boolean; reason?: string } {
  const isSelf = actor.membershipId === target.membershipId;

  if (target.role === 'OWNER' && actor.role !== 'OWNER') {
    return {
      allowed: false,
      reason: 'Only the school owner can change the owner’s account.',
    };
  }

  if (isSelf && (action === 'suspend' || action === 'delete')) {
    return {
      allowed: false,
      reason:
        action === 'suspend'
          ? 'You cannot suspend your own account.'
          : 'You cannot remove your own account.',
    };
  }

  if (isSelf && action === 'role') {
    return {
      allowed: false,
      reason: 'You cannot change your own role. Ask another administrator.',
    };
  }

  return { allowed: true };
}

/**
 * May this role be assigned by this actor?
 *
 * Separate from `canActOn` because it is about the role being GRANTED rather
 * than the person being changed: an admin promoting a librarian to OWNER would
 * pass every check in `canActOn` and still be a privilege escalation.
 */
export function canAssignRole(actorRole: Role, newRole: Role): { allowed: boolean; reason?: string } {
  if (newRole === 'OWNER') {
    return {
      allowed: false,
      reason: 'Ownership is transferred from the owner’s own account, not assigned here.',
    };
  }
  if (newRole === 'APPLICANT') {
    return {
      allowed: false,
      reason: 'An applicant account is created by applying, not by being assigned.',
    };
  }
  if (!ASSIGNABLE_ROLES.includes(newRole)) {
    return { allowed: false, reason: 'That is not a role that can be assigned.' };
  }
  // Everything else is open to whoever holds `user:role:set`, which today is
  // OWNER alone. Kept as a parameter rather than hard-coded so that granting
  // the permission to another role does not require editing this function.
  void actorRole;
  return { allowed: true };
}

/**
 * The last-owner rule.
 *
 * A school must always have exactly one reachable owner. Suspending, demoting
 * or deleting the only one leaves a school nobody can administer — repairable
 * only by the vendor, and the school will not find out until they need it.
 */
export function wouldLeaveSchoolOwnerless(params: {
  targetRole: Role;
  action: 'role' | 'suspend' | 'delete';
  /** Count of ACTIVE owners at this school, including the target. */
  activeOwnerCount: number;
}): boolean {
  if (params.targetRole !== 'OWNER') return false;
  return params.activeOwnerCount <= 1;
}

// -----------------------------------------------------------------------------
// Account details
// -----------------------------------------------------------------------------

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(raw: string): boolean {
  return EMAIL.test(normaliseEmail(raw));
}

export interface PersonDraft {
  /** Either may be absent; the pair is validated by validateIdentifiers. */
  email?: string | null;
  username?: string | null;
  firstName: string;
  lastName: string;
  phone?: string | null;
  role: Role;
  title?: string | null;
}

/**
 * Validate a new or edited person, returning EVERY problem rather than the
 * first.
 *
 * One-at-a-time validation makes a form with four mistakes into four round
 * trips, and the person filling it in is a school secretary entering two
 * hundred pupils.
 */
export function validatePerson(draft: PersonDraft): string[] {
  const problems: string[] = [];

  // Identity is delegated: the rule that an account must carry at least one
  // sign-in identifier belongs with the identifier rules, not duplicated here
  // where it would drift out of step with them.
  problems.push(...validateIdentifiers({ email: draft.email, username: draft.username }));
  if (draft.firstName.trim().length < 1) problems.push('Enter a first name.');
  if (draft.lastName.trim().length < 1) problems.push('Enter a last name.');
  if (draft.firstName.trim().length > 80 || draft.lastName.trim().length > 80) {
    problems.push('Names must be 80 characters or fewer.');
  }
  if (draft.phone && draft.phone.trim().length > 32) {
    problems.push('That phone number is too long.');
  }
  if (!ROLES.includes(draft.role)) problems.push('Choose a role.');

  return problems;
}

// -----------------------------------------------------------------------------
// Password policy
// -----------------------------------------------------------------------------

/**
 * The minimum a password must be.
 *
 * Length only, plus a check against the obvious. Composition rules — an upper,
 * a digit, a symbol — reliably produce `Password1!` and nothing better, while
 * making the rule harder to satisfy honestly. Length is the property that
 * actually costs an attacker something.
 */
export const MIN_PASSWORD_LENGTH = 10;

const OBVIOUS = new Set([
  'password', 'password1', 'password123', 'passw0rd',
  '1234567890', '12345678', 'qwertyuiop', 'letmein123',
  'welcome123', 'admin12345', 'changeme123', 'iloveyou123',
]);

export function passwordProblems(
  password: string,
  person?: { email?: string; firstName?: string; lastName?: string },
): string[] {
  const problems: string[] = [];
  const value = password.trim();

  if (value.length < MIN_PASSWORD_LENGTH) {
    problems.push(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (value.length > 200) {
    // Bcrypt truncates past 72 bytes anyway; the cap is to stop a megabyte of
    // input becoming a slow hash.
    problems.push('That password is too long.');
  }
  if (OBVIOUS.has(value.toLowerCase())) {
    problems.push('That password is too easy to guess.');
  }

  // A password containing the person's own name or email local-part is the
  // first thing anyone tries, and it is the one personalised check worth making.
  const lower = value.toLowerCase();
  const parts = [
    person?.firstName?.trim().toLowerCase(),
    person?.lastName?.trim().toLowerCase(),
    person?.email?.split('@')[0]?.toLowerCase(),
  ].filter((p): p is string => Boolean(p) && p!.length >= 4);
  if (parts.some((p) => lower.includes(p))) {
    problems.push('Do not use your own name or email address in your password.');
  }

  return problems;
}

/**
 * A rough strength reading, 0-4, for a meter beside the field.
 *
 * Deliberately crude and deliberately NOT the thing that decides acceptance —
 * `passwordProblems` does that. A meter's job is to encourage, not to gate; a
 * meter that refuses is just a composition rule with a colour.
 */
export function passwordStrength(password: string): 0 | 1 | 2 | 3 | 4 {
  const value = password.trim();
  if (value.length === 0) return 0;

  let score = 0;
  if (value.length >= MIN_PASSWORD_LENGTH) score += 1;
  if (value.length >= 14) score += 1;
  if (value.length >= 20) score += 1;
  // Variety counts once, not once per class: four classes is not four times
  // better than two at the same length.
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((r) => r.test(value)).length;
  if (classes >= 3) score += 1;

  if (OBVIOUS.has(value.toLowerCase())) return 0;
  return Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
}

export const STRENGTH_LABELS = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'] as const;
