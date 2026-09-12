/**
 * =============================================================================
 * SIGN-IN IDENTIFIERS
 * =============================================================================
 *
 * A person signs in with an email address OR a username. The pure rules for
 * both live here.
 *
 * WHY USERNAMES EXIST AT ALL
 * --------------------------
 * The system started email-only, which is the right default for a product sold
 * to companies and the wrong one for a university in this market. A registrar
 * enrolling an intake of five thousand cannot supply five thousand unique
 * mailboxes; students are known to the institution by matriculation number,
 * and much of the non-teaching staff has no institutional address at all.
 *
 * What happens in practice wherever that constraint is imposed is that the
 * registry invents addresses — which silently destroys the one field anybody
 * would later have used to actually reach a person.
 *
 * So an account carries whichever it has. The rule that it must have AT LEAST
 * ONE is enforced where accounts are created rather than in the schema,
 * because a table-level check is written differently on SQLite and PostgreSQL
 * and this schema stays portable by construction.
 */

export class IdentifierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdentifierError';
  }
}

// -----------------------------------------------------------------------------
// Shape
// -----------------------------------------------------------------------------

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Letters, digits, and the three separators a person can read down a phone
 * line without ambiguity. No spaces, and deliberately no "@" — that absence is
 * what lets an identifier be classified as one kind or the other with
 * certainty rather than by guessing.
 */
const USERNAME = /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/;

/**
 * Usernames the router, the product or the institution already means something
 * by.
 *
 * The office names are refused for a specific reason: somebody holding the
 * username "registrar" impersonates that office in every list that shows an
 * identifier, without ever holding the role.
 */
const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'root', 'system', 'operator', 'support', 'help',
  'registrar', 'registry', 'bursar', 'bursary', 'dean', 'hod', 'owner',
  'api', 'www', 'mail', 'postmaster', 'webmaster', 'security', 'noreply',
  'null', 'undefined', 'test', 'me', 'self', 'anonymous', 'guest',
]);

export function normaliseUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(raw: string): boolean {
  return EMAIL.test(normaliseEmail(raw));
}

export function isValidUsername(raw: string): boolean {
  const value = normaliseUsername(raw);
  return USERNAME.test(value) && !RESERVED_USERNAMES.has(value);
}

/** Names the rule that was broken, because "invalid username" is not actionable. */
export function usernameRejectionReason(raw: string): string | null {
  const value = normaliseUsername(raw);
  if (value.length === 0) return 'Enter a username.';
  if (value.length < 3) return 'A username needs at least three characters.';
  if (value.length > 32) return 'A username can be at most 32 characters.';
  if (value.includes('@')) {
    return 'A username cannot contain an at-sign. Enter it as an email address instead.';
  }
  if (/\s/.test(value)) return 'A username cannot contain spaces.';
  if (!/^[a-z0-9._-]+$/.test(value)) {
    return 'Use letters, numbers, and only full stops, hyphens or underscores.';
  }
  if (!/^[a-z0-9]/.test(value)) return 'A username must start with a letter or number.';
  if (!/[a-z0-9]$/.test(value)) return 'A username must end with a letter or number.';
  if (RESERVED_USERNAMES.has(value)) return `"${value}" is reserved and cannot be used.`;
  return null;
}

// -----------------------------------------------------------------------------
// Classification
// -----------------------------------------------------------------------------

export type IdentifierKind = 'email' | 'username';

/**
 * Which kind of identifier was typed into the sign-in box.
 *
 * Decided on the presence of "@" alone, NOT on whether the value is a valid
 * email. Somebody who mistypes "ada@school" should be told their address is
 * malformed rather than quietly searched for as a username and reported as not
 * found — the second is the same generic failure and leaves them nothing to
 * fix.
 */
export function classifyIdentifier(raw: string): IdentifierKind {
  return raw.includes('@') ? 'email' : 'username';
}

// -----------------------------------------------------------------------------
// Derivation
// -----------------------------------------------------------------------------

/**
 * A username suggested from a person's name: "Adaeze Okafor" becomes
 * "a.okafor".
 *
 * The institutional convention almost everywhere, and it is only a SUGGESTION:
 * the registry overrides it constantly, because two people called Okafor
 * arrive in the same week.
 */
export function suggestUsername(firstName: string, lastName: string): string {
  const strip = (value: string) =>
    value
      .normalize('NFKD')
      // Strip combining marks so "Ọ̀kàfọr" yields "okafor" rather than vanishing.
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');

  const first = strip(firstName);
  const last = strip(lastName);

  if (!first && !last) return '';
  if (!last) return first.slice(0, 32);
  if (!first) return last.slice(0, 32);

  return `${first[0]}.${last}`.slice(0, 32);
}

/**
 * A username derived from a matriculation number: "GEU/CSC/2024/001" becomes
 * "geu.csc.2024.001".
 *
 * Students are known to the institution by that number and will type it from
 * memory long after they have forgotten anything else the system gave them.
 */
export function usernameFromMatric(matric: string): string {
  return matric
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 32);
}

/** Append 2, 3 … until the candidate is free. */
export function disambiguateUsername(
  candidate: string,
  taken: ReadonlySet<string>,
  maxAttempts = 200,
): string {
  const base = normaliseUsername(candidate);
  if (!taken.has(base)) return base;

  for (let n = 2; n <= maxAttempts; n += 1) {
    // No separator before the number: "a.okafor2" reads as one name, whereas
    // "a.okafor.2" reads as a third name component and gets mis-transcribed.
    const next = `${base}${n}`.slice(0, 32);
    if (!taken.has(next)) return next;
  }
  throw new IdentifierError(`Could not find a free username near "${base}".`);
}

// -----------------------------------------------------------------------------
// The "at least one" rule
// -----------------------------------------------------------------------------

export interface AccountIdentifiers {
  email?: string | null;
  username?: string | null;
}

/**
 * Validate the pair, returning every problem rather than the first.
 *
 * An account with neither identifier is not a record with a missing field — it
 * is an account nobody can ever sign in to, and creating one silently is worse
 * than refusing to create it.
 */
export function validateIdentifiers(input: AccountIdentifiers): string[] {
  const problems: string[] = [];
  const email = input.email ? normaliseEmail(input.email) : '';
  const username = input.username ? normaliseUsername(input.username) : '';

  if (!email && !username) {
    return [
      'Give this person an email address or a username — they cannot sign in without one.',
    ];
  }

  if (email && !isValidEmail(email)) problems.push('Enter a valid email address.');
  if (username) {
    const reason = usernameRejectionReason(username);
    if (reason) problems.push(reason);
  }

  return problems;
}

/** What to show in a list when a person may hold only one of the two. */
export function displayIdentifier(user: AccountIdentifiers): string {
  return user.email ?? user.username ?? '—';
}
