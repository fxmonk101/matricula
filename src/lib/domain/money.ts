/**
 * =============================================================================
 * MONEY
 * =============================================================================
 *
 * Every monetary value in this system is an INTEGER number of minor units
 * (kobo, cents, pence). Floating point is never used for money — 0.1 + 0.2 is
 * not 0.3 in IEEE 754, and a bursary that is out by a fraction of a kobo per
 * transaction is out by real money by the end of a term.
 *
 * The type alias `Minor` is documentation, not enforcement; TypeScript has no
 * cheap nominal integers. The discipline is: parse at the edge, store minor,
 * format at the edge.
 */

import { DEFAULT_FINANCE_CONFIG, type CurrencyConfig } from './config';

export type { CurrencyConfig };
export type Minor = number;

/**
 * The DEFAULT currency. Every function below takes an optional currency, so a
 * school on GHS or USD formats its own money without touching a call site.
 */
export const CURRENCY: CurrencyConfig = DEFAULT_FINANCE_CONFIG.currency;

const minorPerMajor = (currency: CurrencyConfig) => 10 ** currency.exponent;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Assert a value is a safe integer count of minor units. */
export function assertMinor(value: number, label = 'amount'): Minor {
  if (!Number.isInteger(value)) {
    throw new MoneyError(`${label} must be an integer number of minor units; received ${value}.`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} exceeds the safe integer range.`);
  }
  return value;
}

/** Convert a major-unit amount (e.g. 1500.75) to minor units (150075). */
export function toMinor(major: number, currency: CurrencyConfig = CURRENCY): Minor {
  if (!Number.isFinite(major)) throw new MoneyError('Amount must be a finite number.');
  return Math.round((major + Number.EPSILON) * minorPerMajor(currency));
}

/** Convert minor units back to a major-unit number. Use only for display. */
export function toMajor(minor: Minor, currency: CurrencyConfig = CURRENCY): number {
  return minor / minorPerMajor(currency);
}

/** Format minor units for display, e.g. 150075 -> "₦1,500.75". */
export function formatMoney(
  minor: Minor,
  opts?: { symbol?: boolean; currency?: CurrencyConfig },
): string {
  const currency = opts?.currency ?? CURRENCY;
  const per = minorPerMajor(currency);
  const showSymbol = opts?.symbol ?? true;
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const major = Math.floor(abs / per);
  const remainder = abs % per;

  const fraction =
    currency.exponent === 0 ? '' : `.${String(remainder).padStart(currency.exponent, '0')}`;
  const prefix = showSymbol ? currency.symbol : '';
  return `${negative ? '-' : ''}${prefix}${major.toLocaleString('en-US')}${fraction}`;
}

/** Compact display for dashboard tiles, e.g. "₦12.4M". */
export function formatMoneyCompact(minor: Minor, currency: CurrencyConfig = CURRENCY): string {
  const major = Math.abs(toMajor(minor, currency));
  const sign = minor < 0 ? '-' : '';
  const s = currency.symbol;
  if (major >= 1_000_000_000) return `${sign}${s}${(major / 1_000_000_000).toFixed(1)}B`;
  if (major >= 1_000_000) return `${sign}${s}${(major / 1_000_000).toFixed(1)}M`;
  if (major >= 1_000) return `${sign}${s}${(major / 1_000).toFixed(1)}K`;
  return formatMoney(minor, { currency });
}

/**
 * Bind the formatters to one school's currency for the life of a request.
 *
 * Server components and services have a config in scope but no way to thread a
 * currency through every `formatMoney` call site; this hands them a bound pair
 * instead, so a page renders Naira or Cedis without each component knowing.
 */
export function makeMoney(currency: CurrencyConfig) {
  return {
    currency,
    format: (minor: Minor, opts?: { symbol?: boolean }) =>
      formatMoney(minor, { ...opts, currency }),
    formatCompact: (minor: Minor) => formatMoneyCompact(minor, currency),
    toMinor: (major: number) => toMinor(major, currency),
    toMajor: (minor: Minor) => toMajor(minor, currency),
  };
}

export type Money = ReturnType<typeof makeMoney>;

/**
 * Split an amount into `parts` as evenly as possible with no lost minor units.
 *
 * Naive division loses money: 100 kobo split three ways is 33.33 each, and
 * 33 + 33 + 33 = 99. The remainder is distributed one minor unit at a time
 * across the leading parts, so the parts always sum exactly to the input.
 * This is the standard allocation algorithm for instalment plans.
 */
export function allocateEvenly(total: Minor, parts: number): Minor[] {
  assertMinor(total, 'total');
  if (parts <= 0) throw new MoneyError('Part count must be positive.');

  const base = Math.floor(total / parts);
  let remainder = total - base * parts;

  return Array.from({ length: parts }, () => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return base + extra;
  });
}

/** Apply a percentage discount, rounding half-up to the nearest minor unit. */
export function applyPercentage(amount: Minor, percent: number): Minor {
  assertMinor(amount, 'amount');
  if (percent < 0 || percent > 100) {
    throw new MoneyError(`Percentage must be within [0, 100]; received ${percent}.`);
  }
  return Math.round((amount * percent) / 100 + Number.EPSILON);
}

export function sumMinor(values: readonly Minor[]): Minor {
  return values.reduce<Minor>((acc, v) => acc + v, 0);
}
