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

export type Minor = number;

export const CURRENCY = {
  code: 'NGN',
  symbol: '₦',
  /** Number of decimal places in the minor unit. */
  exponent: 2,
} as const;

const MINOR_PER_MAJOR = 10 ** CURRENCY.exponent;

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
export function toMinor(major: number): Minor {
  if (!Number.isFinite(major)) throw new MoneyError('Amount must be a finite number.');
  return Math.round((major + Number.EPSILON) * MINOR_PER_MAJOR);
}

/** Convert minor units back to a major-unit number. Use only for display. */
export function toMajor(minor: Minor): number {
  return minor / MINOR_PER_MAJOR;
}

/** Format minor units for display, e.g. 150075 -> "₦1,500.75". */
export function formatMoney(minor: Minor, opts?: { symbol?: boolean }): string {
  const showSymbol = opts?.symbol ?? true;
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const major = Math.floor(abs / MINOR_PER_MAJOR);
  const remainder = abs % MINOR_PER_MAJOR;

  const body = `${major.toLocaleString('en-US')}.${String(remainder).padStart(CURRENCY.exponent, '0')}`;
  const prefix = showSymbol ? CURRENCY.symbol : '';
  return `${negative ? '-' : ''}${prefix}${body}`;
}

/** Compact display for dashboard tiles, e.g. "₦12.4M". */
export function formatMoneyCompact(minor: Minor): string {
  const major = Math.abs(toMajor(minor));
  const sign = minor < 0 ? '-' : '';
  if (major >= 1_000_000_000) return `${sign}${CURRENCY.symbol}${(major / 1_000_000_000).toFixed(1)}B`;
  if (major >= 1_000_000) return `${sign}${CURRENCY.symbol}${(major / 1_000_000).toFixed(1)}M`;
  if (major >= 1_000) return `${sign}${CURRENCY.symbol}${(major / 1_000).toFixed(1)}K`;
  return formatMoney(minor);
}

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
