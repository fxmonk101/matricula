import { describe, expect, it } from 'vitest';

import {
  IdentifierError,
  classifyIdentifier,
  disambiguateUsername,
  displayIdentifier,
  isValidEmail,
  isValidUsername,
  normaliseUsername,
  suggestUsername,
  usernameFromMatric,
  usernameRejectionReason,
  validateIdentifiers,
} from '@/lib/domain/identifier';

describe('classifying what was typed into the sign-in box', () => {
  it('decides on the at-sign alone, not on validity', () => {
    /*
     * The decisive case. Somebody who mistypes "ada@school" must be told their
     * ADDRESS is malformed — if validity decided the classification, that
     * string would be searched for as a username, come back not-found, and
     * they would be shown a generic failure with nothing to fix.
     */
    expect(classifyIdentifier('ada@school')).toBe('email');
    expect(classifyIdentifier('ada@school.edu')).toBe('email');
    expect(classifyIdentifier('a.okafor')).toBe('username');
    expect(classifyIdentifier('geu.csc.2024.001')).toBe('username');
  });
});

describe('usernames', () => {
  it('accepts the shapes an institution actually issues', () => {
    for (const value of ['a.okafor', 'aokafor', 'geu.csc.2024.001', 'staff_101', 'jane-doe']) {
      expect(isValidUsername(value), value).toBe(true);
    }
  });

  it('is case-insensitive by normalising on the way in', () => {
    // "A.Okafor" and "a.okafor" must not be able to become two accounts.
    expect(normaliseUsername('  A.Okafor ')).toBe('a.okafor');
    expect(isValidUsername('A.Okafor')).toBe(true);
  });

  it('refuses an at-sign, which is what keeps classification unambiguous', () => {
    expect(isValidUsername('a@b')).toBe(false);
    expect(usernameRejectionReason('a@b')).toMatch(/at-sign/);
  });

  it('refuses office names that would let somebody impersonate a desk', () => {
    // A person whose username is "registrar" appears to be the registry in
    // every list that shows an identifier, while holding no such role.
    for (const value of ['registrar', 'bursar', 'admin', 'dean', 'owner', 'support']) {
      expect(isValidUsername(value), value).toBe(false);
      expect(usernameRejectionReason(value), value).toMatch(/reserved/);
    }
  });

  it('names the rule that was broken', () => {
    expect(usernameRejectionReason('')).toMatch(/Enter a username/);
    expect(usernameRejectionReason('ab')).toMatch(/three characters/);
    expect(usernameRejectionReason('x'.repeat(40))).toMatch(/at most 32/);
    expect(usernameRejectionReason('has space')).toMatch(/spaces/);
    expect(usernameRejectionReason('.leading')).toMatch(/start with/);
    expect(usernameRejectionReason('trailing.')).toMatch(/end with/);
    expect(usernameRejectionReason('bad!char')).toMatch(/full stops, hyphens or underscores/);
  });

  it('accepts a good username with no complaint', () => {
    expect(usernameRejectionReason('a.okafor')).toBeNull();
  });
});

describe('deriving a username', () => {
  it('follows the institutional convention', () => {
    expect(suggestUsername('Adaeze', 'Okafor')).toBe('a.okafor');
    expect(suggestUsername('Tunde', 'Bakare')).toBe('t.bakare');
  });

  it('strips diacritics rather than dropping the letter', () => {
    // A username is typed from a printed slip and read down a phone line, so
    // it is ASCII — but the name must survive as something recognisable.
    expect(suggestUsername('Ọbi', 'Ọkàfọr')).toBe('o.okafor');
    expect(suggestUsername('Zoë', 'Müller')).toBe('z.muller');
  });

  it('copes with one name missing', () => {
    expect(suggestUsername('', 'Okafor')).toBe('okafor');
    expect(suggestUsername('Adaeze', '')).toBe('adaeze');
    expect(suggestUsername('', '')).toBe('');
  });

  it('derives one from a matriculation number', () => {
    // Students remember this number long after they have forgotten anything
    // else the system gave them.
    expect(usernameFromMatric('GEU/CSC/2024/001')).toBe('geu.csc.2024.001');
    expect(usernameFromMatric('  GEU-CSC-2024-001  ')).toBe('geu.csc.2024.001');
  });

  it('produces something valid from what it derives', () => {
    for (const [first, last] of [['Adaeze', 'Okafor'], ['Ọbi', 'Ọkàfọr'], ['Zoë', 'Müller']]) {
      expect(isValidUsername(suggestUsername(first, last))).toBe(true);
    }
    expect(isValidUsername(usernameFromMatric('GEU/CSC/2024/001'))).toBe(true);
  });
});

describe('disambiguation', () => {
  it('leaves a free candidate alone', () => {
    expect(disambiguateUsername('a.okafor', new Set())).toBe('a.okafor');
  });

  it('appends a counter with no separator', () => {
    // "a.okafor.2" reads as a third name component and gets mis-transcribed;
    // "a.okafor2" reads as one name.
    expect(disambiguateUsername('a.okafor', new Set(['a.okafor']))).toBe('a.okafor2');
    expect(disambiguateUsername('a.okafor', new Set(['a.okafor', 'a.okafor2']))).toBe('a.okafor3');
  });

  it('normalises the candidate before comparing', () => {
    expect(disambiguateUsername('A.Okafor', new Set(['a.okafor']))).toBe('a.okafor2');
  });

  it('gives up rather than looping forever', () => {
    const taken = new Set(['x', ...Array.from({ length: 60 }, (_, i) => `x${i + 2}`)]);
    expect(() => disambiguateUsername('x', taken, 20)).toThrow(IdentifierError);
  });
});

describe('the at-least-one rule', () => {
  it('accepts an account with only an email', () => {
    expect(validateIdentifiers({ email: 'a@b.test' })).toEqual([]);
  });

  it('accepts an account with only a username', () => {
    // The whole point: a registrar enrolling five thousand students cannot
    // supply five thousand mailboxes.
    expect(validateIdentifiers({ username: 'a.okafor' })).toEqual([]);
  });

  it('accepts both', () => {
    expect(validateIdentifiers({ email: 'a@b.test', username: 'a.okafor' })).toEqual([]);
  });

  it('REFUSES an account with neither', () => {
    // Not a record with a missing field — an account nobody can ever sign in
    // to, which is worse to create silently than to refuse.
    const problems = validateIdentifiers({});
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/cannot sign in/);

    expect(validateIdentifiers({ email: '', username: '' })).toHaveLength(1);
    expect(validateIdentifiers({ email: null, username: null })).toHaveLength(1);
  });

  it('reports a malformed identifier that WAS supplied', () => {
    expect(validateIdentifiers({ email: 'nope' }).join(' ')).toMatch(/valid email/);
    expect(validateIdentifiers({ username: 'registrar' }).join(' ')).toMatch(/reserved/);
  });

  it('reports both problems at once when both are malformed', () => {
    expect(validateIdentifiers({ email: 'nope', username: 'a b' })).toHaveLength(2);
  });
});

describe('display', () => {
  it('prefers the email, falls back to the username', () => {
    expect(displayIdentifier({ email: 'a@b.test', username: 'a.okafor' })).toBe('a@b.test');
    expect(displayIdentifier({ username: 'a.okafor' })).toBe('a.okafor');
    expect(displayIdentifier({ email: null, username: 'a.okafor' })).toBe('a.okafor');
  });

  it('never renders "null" into a page', () => {
    expect(displayIdentifier({})).toBe('—');
  });
});

describe('emails still work as before', () => {
  it('accepts and normalises', () => {
    expect(isValidEmail('  Ada@School.TEST ')).toBe(true);
  });

  it('refuses the malformed', () => {
    for (const bad of ['no-at-sign', 'two@@at.test', 'trailing@dot', '@nolocal.test']) {
      expect(isValidEmail(bad), bad).toBe(false);
    }
  });
});
