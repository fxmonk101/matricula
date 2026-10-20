import { describe, expect, it } from 'vitest';

import { hasValidAuthSecret } from '@/lib/auth/jwt';

describe('auth configuration checks', () => {
  it('rejects a missing or undersized signing secret', () => {
    const original = process.env.AUTH_SECRET;
    delete process.env.AUTH_SECRET;
    try {
      expect(hasValidAuthSecret()).toBe(false);
    } finally {
      if (original === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = original;
    }
  });

  it('accepts a secret long enough for JWT signing', () => {
    const original = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = '0123456789abcdef0123456789abcdef';
    try {
      expect(hasValidAuthSecret()).toBe(true);
    } finally {
      if (original === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = original;
    }
  });
});
