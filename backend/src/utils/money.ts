/**
 * Decimal money arithmetic on strings, via BigInt minor units.
 *
 * Money never touches a JS `number` anywhere in the billing code, because
 * binary floating point cannot represent most decimal fractions: `0.1 + 0.2`
 * is `0.30000000000000004`, and summing a few thousand invoices that way
 * produces a revenue total that is quietly wrong. Postgres `numeric` keeps the
 * values exact at rest, and these helpers keep them exact in transit.
 *
 * Everything here works in hundredths (two decimal places), which is what the
 * `numeric(12, 2)` columns store and what Bachs sends and accepts.
 */

const SCALE = 2n;
const SCALE_FACTOR = 100n; // 10 ** SCALE

/** A decimal string with at most two places, optionally signed. */
const MONEY_PATTERN = /^-?\d+(\.\d{1,2})?$/;

export function isMoneyString(value: string): boolean {
  return MONEY_PATTERN.test(value.trim());
}

/**
 * Parse a decimal string into minor units. Throws rather than coercing: a bad
 * amount reaching the ledger is worse than a failed request, and every caller
 * here is either validating user input or reading a column we wrote ourselves.
 */
export function toMinorUnits(value: string): bigint {
  const trimmed = value.trim();
  if (!isMoneyString(trimmed)) {
    throw new Error(`Not a two-decimal money string: ${value}`);
  }

  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole, fraction = ''] = unsigned.split('.');
  // Right-pad so "1.5" and "1.50" are the same 150 minor units.
  const padded = fraction.padEnd(Number(SCALE), '0');
  const minor = BigInt(whole) * SCALE_FACTOR + BigInt(padded);
  return negative ? -minor : minor;
}

/** Render minor units back to a two-decimal string, always with both places. */
export function fromMinorUnits(minor: bigint): string {
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const whole = absolute / SCALE_FACTOR;
  const fraction = absolute % SCALE_FACTOR;
  const rendered = `${whole}.${fraction.toString().padStart(Number(SCALE), '0')}`;
  return negative ? `-${rendered}` : rendered;
}

/** Sum decimal strings exactly. An empty list is `'0.00'`, not `'0'`. */
export function sumMoney(values: readonly string[]): string {
  return fromMinorUnits(values.reduce((total, value) => total + toMinorUnits(value), 0n));
}

export function addMoney(a: string, b: string): string {
  return fromMinorUnits(toMinorUnits(a) + toMinorUnits(b));
}

export function subtractMoney(a: string, b: string): string {
  return fromMinorUnits(toMinorUnits(a) - toMinorUnits(b));
}

export function compareMoney(a: string, b: string): -1 | 0 | 1 {
  const left = toMinorUnits(a);
  const right = toMinorUnits(b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function isPositiveMoney(value: string): boolean {
  return toMinorUnits(value) > 0n;
}

export const ZERO_MONEY = '0.00';

/**
 * Multiply by a rate expressed in basis points, truncating toward zero.
 *
 * The rate arrives as a float (`developerPoolRate = 0.15`) but is converted to
 * an integer basis-point count before it touches an amount, so the
 * multiplication itself is exact. Truncation is deliberate: the pool must never
 * round *up* past the share we actually promised.
 */
export function applyRate(value: string, rateBasisPoints: bigint): string {
  return fromMinorUnits((toMinorUnits(value) * rateBasisPoints) / 10_000n);
}

/**
 * Split `total` across integer weights, largest-remainder style.
 *
 * A naive per-share truncation loses up to one minor unit per recipient, so a
 * pool would never fully distribute. This allocates the truncated shares first,
 * then hands the leftover minor units out one at a time to the largest
 * remainders, which guarantees the parts sum to exactly `total`.
 */
export function allocateByWeight(total: string, weights: readonly bigint[]): string[] {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0n);
  if (totalWeight <= 0n) return weights.map(() => ZERO_MONEY);

  const totalMinor = toMinorUnits(total);
  const shares: bigint[] = [];
  const remainders: { index: number; remainder: bigint }[] = [];

  let allocated = 0n;
  weights.forEach((weight, index) => {
    const exact = totalMinor * weight;
    const share = exact / totalWeight;
    shares.push(share);
    allocated += share;
    remainders.push({ index, remainder: exact % totalWeight });
  });

  // Distribute what truncation left behind, biggest remainder first. Ties break
  // on index so the result is deterministic and a re-run cannot reshuffle.
  let leftover = totalMinor - allocated;
  remainders.sort((a, b) => (b.remainder === a.remainder ? a.index - b.index : b.remainder > a.remainder ? 1 : -1));
  for (const entry of remainders) {
    if (leftover <= 0n) break;
    shares[entry.index] += 1n;
    leftover -= 1n;
  }

  return shares.map(fromMinorUnits);
}
