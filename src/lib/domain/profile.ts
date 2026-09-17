/**
 * =============================================================================
 * A PERSON'S OWN ACCOUNT
 * =============================================================================
 *
 * What somebody may change about themselves, and the rules that apply when they
 * do. Pure: no database, no session, no mailer.
 *
 * The distinction this module keeps is between the things a person owns and the
 * things the institution owns. A display name, a username, a photograph and a
 * password are the person's. A matriculation number, a department, a role and a
 * staff number are the INSTITUTION'S — they are assertions the school makes
 * about somebody, and letting the subject of an assertion edit it is how a
 * register stops being evidence of anything.
 */

import { normaliseUsername, usernameRejectionReason } from './identifier';

export const NAME_MAX = 80;
export const PHONE_MAX = 32;

/** Fields a person may change about themselves without the office. */
export interface ProfileDraft {
  firstName: string;
  lastName: string;
  username: string;
  phone: string;
}

export function validateProfile(draft: ProfileDraft): string[] {
  const problems: string[] = [];

  const first = draft.firstName.trim();
  const last = draft.lastName.trim();

  if (!first) problems.push('Enter your first name.');
  else if (first.length > NAME_MAX) problems.push('That first name is too long.');

  if (!last) problems.push('Enter your last name.');
  else if (last.length > NAME_MAX) problems.push('That last name is too long.');

  const username = draft.username.trim();
  if (username) {
    // Names the rule that was broken, because "invalid username" is not
    // actionable to somebody who cannot see the rule.
    const reason = usernameRejectionReason(username);
    if (reason) problems.push(reason);
  }

  const phone = draft.phone.trim();
  if (phone) {
    if (phone.length > PHONE_MAX) problems.push('That phone number is too long.');
    // Deliberately permissive. Numbers in this market are written +234 803…,
    // 0803…, and with spaces or dashes, and a strict pattern would reject more
    // real numbers than fake ones.
    else if (!/^[+()\d][\d\s()+-]*$/.test(phone)) {
      problems.push('A phone number can contain digits, spaces, brackets, + and -.');
    }
  }

  return problems;
}

// -----------------------------------------------------------------------------
// Changing a password
// -----------------------------------------------------------------------------

export const PASSWORD_MIN = 10;

/**
 * How long a confirmation link is good for.
 *
 * One hour. Long enough to walk to another building and open a mailbox, short
 * enough that a link sitting unread in an inbox for a week is not a standing
 * key to somebody's account.
 */
export const CONFIRM_TTL_MINUTES = 60;

export interface PasswordChangeDraft {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

/**
 * Validate a password change BEFORE the current password is checked.
 *
 * Kept separate from the credential check on purpose: this runs on input the
 * user can see and fix, and returns every problem at once. Whether the current
 * password is right is a different question, answered by the service against a
 * hash, and reported on its own so the two never blur into "something was
 * wrong".
 */
export function validatePasswordChange(draft: PasswordChangeDraft): string[] {
  const problems: string[] = [];

  if (!draft.currentPassword) {
    problems.push('Enter your current password.');
  }

  const next = draft.newPassword;
  if (!next) {
    problems.push('Enter a new password.');
  } else {
    if (next.length < PASSWORD_MIN) {
      problems.push(`A password needs at least ${PASSWORD_MIN} characters.`);
    }
    if (next.length > 200) problems.push('That password is too long.');
    // Length is the requirement that actually helps. A composition rule drives
    // people to Password1! and no further, so the only other check here is that
    // the password is not literally the thing being replaced.
    if (draft.currentPassword && next === draft.currentPassword) {
      problems.push('The new password must be different from the current one.');
    }
  }

  if (next && draft.confirmPassword !== next) {
    problems.push('The two new passwords do not match.');
  }

  return problems;
}

/**
 * Can this account confirm a change by email?
 *
 * Email is OPTIONAL on a user in this system, deliberately — a university
 * creating five thousand student accounts cannot invent five thousand
 * mailboxes. So a password change cannot REQUIRE email confirmation without
 * locking every account that has no address out of ever changing its password.
 *
 * The rule is therefore: confirm by email where there is an address, and fall
 * back to the current password alone where there is not. The person is told
 * which of the two happened, because "we have emailed you" to somebody with no
 * email address is how a person waits forever for a message nobody sent.
 */
export function confirmationRoute(email: string | null | undefined): 'EMAIL' | 'IMMEDIATE' {
  return email && email.includes('@') ? 'EMAIL' : 'IMMEDIATE';
}

/** Mask an address for display: `a****e@geu.edu`. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '·····';
  if (local.length <= 2) return `${local[0] ?? ''}···@${domain}`;
  return `${local[0]}${'·'.repeat(Math.min(6, local.length - 2))}${local[local.length - 1]}@${domain}`;
}

// -----------------------------------------------------------------------------
// Profile pictures
// -----------------------------------------------------------------------------

/**
 * A profile picture is small on purpose.
 *
 * It renders in a 40px circle in the shell and at most a few hundred pixels on
 * this page. Accepting a 12-megapixel phone photograph would store fifty times
 * the bytes anybody will ever see, on a row read on every authenticated page
 * load.
 */
export const AVATAR_MAX_BYTES = 3 * 1024 * 1024;
export const AVATAR_EDGE = 512;

/** Initials for the fallback, when somebody has no picture. */
export function initialsOf(firstName: string, lastName: string): string {
  const a = firstName.trim()[0] ?? '';
  const b = lastName.trim()[0] ?? '';
  return `${a}${b}`.toUpperCase() || '?';
}
