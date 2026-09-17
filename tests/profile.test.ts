import { describe, expect, it } from 'vitest';

import {
  PASSWORD_MIN,
  confirmationRoute,
  initialsOf,
  maskEmail,
  validatePasswordChange,
  validateProfile,
} from '@/lib/domain/profile';

const goodProfile = {
  firstName: 'Adaeze',
  lastName: 'Okafor',
  username: 'a.okafor',
  phone: '+234 803 000 0000',
};

describe('editing your own details', () => {
  it('accepts an ordinary profile', () => {
    expect(validateProfile(goodProfile)).toEqual([]);
  });

  it('requires a name', () => {
    expect(validateProfile({ ...goodProfile, firstName: '  ' }).join(' ')).toMatch(/first name/);
    expect(validateProfile({ ...goodProfile, lastName: '' }).join(' ')).toMatch(/last name/);
  });

  it('allows a blank username, since email is the other way in', () => {
    // Whether clearing it is SAFE depends on whether the account has an email,
    // which is a question about the record rather than about the form — so it
    // is answered in the service, not here.
    expect(validateProfile({ ...goodProfile, username: '' })).toEqual([]);
  });

  it('names the rule a username broke', () => {
    // "Invalid username" is not actionable to somebody who cannot see the rule.
    expect(validateProfile({ ...goodProfile, username: 'a b' }).join(' ')).toMatch(/spaces/);
    expect(validateProfile({ ...goodProfile, username: 'ab' }).join(' ')).toMatch(/three/);
    expect(validateProfile({ ...goodProfile, username: 'a.okafor@geu.edu' }).join(' ')).toMatch(
      /at-sign/,
    );
  });

  it('accepts the phone formats this market actually writes', () => {
    for (const phone of ['+234 803 000 0000', '08030000000', '(0803) 000-0000', '+233 24 000 0000']) {
      expect(validateProfile({ ...goodProfile, phone })).toEqual([]);
    }
  });

  it('refuses a phone number that is not one', () => {
    expect(validateProfile({ ...goodProfile, phone: 'call me' }).join(' ')).toMatch(/phone number/);
  });

  it('allows no phone at all', () => {
    expect(validateProfile({ ...goodProfile, phone: '' })).toEqual([]);
  });
});

describe('changing a password', () => {
  const good = {
    currentPassword: 'Password123!',
    newPassword: 'a-much-longer-one',
    confirmPassword: 'a-much-longer-one',
  };

  it('accepts a well-formed change', () => {
    expect(validatePasswordChange(good)).toEqual([]);
  });

  it('requires the current password', () => {
    expect(validatePasswordChange({ ...good, currentPassword: '' }).join(' ')).toMatch(
      /current password/,
    );
  });

  it('enforces a length floor rather than a composition rule', () => {
    /*
     * Length is the requirement that actually helps. A composition rule drives
     * people to Password1! and no further, so the only other check is that the
     * new password is not the old one.
     */
    const short = 'a'.repeat(PASSWORD_MIN - 1);
    expect(
      validatePasswordChange({ ...good, newPassword: short, confirmPassword: short }).join(' '),
    ).toMatch(new RegExp(`${PASSWORD_MIN} characters`));

    const long = 'all lowercase words with no symbols at all';
    expect(validatePasswordChange({ ...good, newPassword: long, confirmPassword: long })).toEqual(
      [],
    );
  });

  it('refuses a new password identical to the current one', () => {
    expect(
      validatePasswordChange({
        currentPassword: 'Password123!',
        newPassword: 'Password123!',
        confirmPassword: 'Password123!',
      }).join(' '),
    ).toMatch(/different/);
  });

  it('catches a mistyped confirmation', () => {
    expect(
      validatePasswordChange({ ...good, confirmPassword: 'a-much-longer-onf' }).join(' '),
    ).toMatch(/do not match/);
  });

  it('reports every problem at once', () => {
    const problems = validatePasswordChange({
      currentPassword: '',
      newPassword: 'short',
      confirmPassword: 'different',
    });
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });
});

describe('which accounts can confirm by email', () => {
  it('confirms by email where there is an address', () => {
    expect(confirmationRoute('a.okafor@geu.edu')).toBe('EMAIL');
  });

  it('applies immediately where there is NOT', () => {
    /*
     * Email is optional on a user in this system — a university creating five
     * thousand student accounts cannot invent five thousand mailboxes. So
     * requiring email confirmation unconditionally would lock every account
     * without an address out of ever changing its password.
     */
    expect(confirmationRoute(null)).toBe('IMMEDIATE');
    expect(confirmationRoute('')).toBe('IMMEDIATE');
    expect(confirmationRoute(undefined)).toBe('IMMEDIATE');
    // Not an address, so there is nothing to send to.
    expect(confirmationRoute('not-an-address')).toBe('IMMEDIATE');
  });
});

describe('showing an address without showing it', () => {
  it('keeps the domain and the shape, hides the rest', () => {
    const masked = maskEmail('a.okafor@geu.edu');
    expect(masked).toMatch(/@geu\.edu$/);
    expect(masked).not.toContain('okafor');
    expect(masked.startsWith('a')).toBe(true);
  });

  it('does not fall over on a short local part', () => {
    expect(maskEmail('ab@geu.edu')).toMatch(/@geu\.edu$/);
    expect(maskEmail('a@geu.edu')).toMatch(/@geu\.edu$/);
  });

  it('does not leak anything for a value that is not an address', () => {
    expect(maskEmail('nonsense')).toBe('·····');
  });
});

describe('initials', () => {
  it('takes the first letter of each name', () => {
    expect(initialsOf('Adaeze', 'Okafor')).toBe('AO');
  });

  it('copes with a missing name rather than rendering nothing', () => {
    expect(initialsOf('Adaeze', '')).toBe('A');
    expect(initialsOf('', '')).toBe('?');
    expect(initialsOf('  ', '  ')).toBe('?');
  });
});
