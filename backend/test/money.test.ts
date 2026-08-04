import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addMoney,
  allocateByWeight,
  applyRate,
  compareMoney,
  fromMinorUnits,
  isMoneyString,
  subtractMoney,
  sumMoney,
  toMinorUnits,
} from '../src/utils/money';

/**
 * These are the arithmetic guarantees the revenue ledger, the refund path, and
 * the developer pool all rest on. This module has no imports beyond itself, so
 * unlike the other suites it exercises the real implementation rather than a
 * re-stated contract.
 */

describe('money parsing', () => {
  it('accepts the shapes Bachs and Postgres actually produce', () => {
    assert.equal(toMinorUnits('5.00'), 500n);
    // `numeric` renders a trailing zero, a Bachs payload may not.
    assert.equal(toMinorUnits('5.0'), 500n);
    assert.equal(toMinorUnits('5'), 500n);
    assert.equal(toMinorUnits('0.05'), 5n);
    assert.equal(toMinorUnits('-2.50'), -250n);
  });

  it('rejects anything that is not exact two-decimal money', () => {
    // Three decimals means a rounding decision we have not been told how to
    // make, so it is refused rather than silently truncated.
    assert.equal(isMoneyString('1.234'), false);
    assert.equal(isMoneyString('1e3'), false);
    assert.equal(isMoneyString('abc'), false);
    assert.equal(isMoneyString(''), false);
    assert.throws(() => toMinorUnits('1.234'));
  });

  it('always renders both decimal places', () => {
    assert.equal(fromMinorUnits(500n), '5.00');
    assert.equal(fromMinorUnits(5n), '0.05');
    assert.equal(fromMinorUnits(0n), '0.00');
    assert.equal(fromMinorUnits(-250n), '-2.50');
  });

  it('round-trips without drift', () => {
    for (const value of ['0.01', '5.00', '30.00', '300.00', '99999.99']) {
      assert.equal(fromMinorUnits(toMinorUnits(value)), value);
    }
  });
});

describe('money arithmetic', () => {
  it('adds without binary floating point error', () => {
    // 0.1 + 0.2 === 0.30000000000000004 as JS numbers. This is the entire
    // reason the module exists.
    assert.equal(addMoney('0.10', '0.20'), '0.30');
    assert.equal(sumMoney(['0.10', '0.20', '0.30']), '0.60');
  });

  it('sums a realistic month of invoices exactly', () => {
    // 1000 Pro subscriptions at $5. A float accumulator drifts here; this
    // must not.
    const invoices = Array.from({ length: 1000 }, () => '5.00');
    assert.equal(sumMoney(invoices), '5000.00');
  });

  it('treats an empty ledger as 0.00 rather than 0', () => {
    assert.equal(sumMoney([]), '0.00');
  });

  it('subtracts and compares', () => {
    assert.equal(subtractMoney('5.00', '1.25'), '3.75');
    // A refund larger than the charge must be representable so the caller can
    // detect it, rather than silently clamping to zero.
    assert.equal(subtractMoney('1.00', '3.00'), '-2.00');
    assert.equal(compareMoney('5.00', '5.0'), 0);
    assert.equal(compareMoney('4.99', '5.00'), -1);
    assert.equal(compareMoney('5.01', '5.00'), 1);
  });
});

describe('pool rate', () => {
  it('takes 15% of collected revenue', () => {
    assert.equal(applyRate('100.00', 1500n), '15.00');
    assert.equal(applyRate('5.00', 1500n), '0.75');
  });

  it('truncates rather than rounding up', () => {
    // 0.01 * 15% = 0.0015, which must not become a cent we did not promise.
    assert.equal(applyRate('0.01', 1500n), '0.00');
    // 3.33 * 15% = 0.4995 → 0.49, not 0.50.
    assert.equal(applyRate('3.33', 1500n), '0.49');
  });

  it('returns zero for an empty month', () => {
    assert.equal(applyRate('0.00', 1500n), '0.00');
  });
});

describe('pool allocation', () => {
  it('splits evenly when weights are equal', () => {
    assert.deepEqual(allocateByWeight('30.00', [1n, 1n, 1n]), ['10.00', '10.00', '10.00']);
  });

  it('distributes remainder cents instead of losing them', () => {
    // $10 across 3 developers is 3.333…; naive truncation pays 9.99 and leaves
    // a cent stranded in the pool forever.
    const shares = allocateByWeight('10.00', [1n, 1n, 1n]);
    assert.equal(sumMoney(shares), '10.00');
    assert.deepEqual(shares, ['3.34', '3.33', '3.33']);
  });

  it('always sums to exactly the pool total', () => {
    // The invariant that matters: whatever the weights, we never pay out more
    // or less than the pool.
    const cases: { total: string; weights: bigint[] }[] = [
      { total: '100.00', weights: [7n, 11n, 13n, 17n] },
      { total: '0.03', weights: [1n, 1n, 1n, 1n, 1n] },
      { total: '1234.56', weights: [1n, 2n, 3n, 4n, 5n, 6n, 7n] },
      { total: '0.01', weights: [1n, 1n] },
    ];
    for (const { total, weights } of cases) {
      assert.equal(sumMoney(allocateByWeight(total, weights)), total);
    }
  });

  it('weights the split by usage', () => {
    const shares = allocateByWeight('100.00', [90n, 10n]);
    assert.deepEqual(shares, ['90.00', '10.00']);
  });

  it('pays nobody when there is no measured usage', () => {
    // No usage means no basis for a split; the money stays in the pool rather
    // than being divided arbitrarily.
    assert.deepEqual(allocateByWeight('100.00', [0n, 0n]), ['0.00', '0.00']);
    assert.deepEqual(allocateByWeight('100.00', []), []);
  });

  it('is deterministic across runs', () => {
    // The distribution job is re-runnable, so an identical input must produce
    // an identical split rather than reshuffling who gets the spare cent.
    const first = allocateByWeight('10.00', [1n, 1n, 1n]);
    const second = allocateByWeight('10.00', [1n, 1n, 1n]);
    assert.deepEqual(first, second);
  });
});
