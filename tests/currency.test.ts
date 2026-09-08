import { describe, expect, it } from 'vitest';

import { currencyFor, formatMoney, toMinor, toMajor } from '@/lib/domain/money';

describe('currency resolution', () => {
  it('knows the currencies the platform is sold in', () => {
    expect(currencyFor('NGN')).toEqual({ code: 'NGN', symbol: '₦', exponent: 2 });
    expect(currencyFor('GHS').symbol).toBe('₵');
    expect(currencyFor('GBP').symbol).toBe('£');
  });

  it('is case-insensitive on the code', () => {
    expect(currencyFor('ngn').symbol).toBe('₦');
  });

  it('carries the right exponent for a zero-decimal currency', () => {
    // The exponent matters more than the symbol. A wrong symbol is cosmetic; a
    // wrong exponent misstates every amount by a factor of a hundred.
    expect(currencyFor('JPY').exponent).toBe(0);
    expect(toMinor(1500, currencyFor('JPY'))).toBe(1500);
    expect(toMinor(1500, currencyFor('NGN'))).toBe(150_000);
  });

  it('round-trips major and minor units', () => {
    for (const code of ['NGN', 'JPY', 'USD']) {
      const currency = currencyFor(code);
      expect(toMajor(toMinor(1234, currency), currency), code).toBe(1234);
    }
  });

  it('falls back to the CODE for an unknown currency, never to a default symbol', () => {
    // Rendering an unrecognised amount with a naira sign would state something
    // false. Showing it with its own code states exactly what is known.
    const xof = currencyFor('XOF');
    expect(xof.code).toBe('XOF');
    expect(xof.symbol).not.toBe('₦');
    expect(formatMoney(150_000, { currency: xof })).toContain('XOF');
  });
});

describe('formatting subscription amounts', () => {
  it('renders a zero-decimal currency without a fractional part', () => {
    expect(formatMoney(1500, { currency: currencyFor('JPY') })).toBe('¥1,500');
  });

  it('renders a two-decimal currency with one', () => {
    expect(formatMoney(48_000_000, { currency: currencyFor('NGN') })).toBe('₦480,000.00');
  });

  it('keeps the sign outside the symbol on a credit', () => {
    expect(formatMoney(-12_500, { currency: currencyFor('USD') })).toBe('-$125.00');
  });
});
