import { describe, it, expect } from 'vitest';
import {
  convertAmount, currencyLabel, currencySymbol, formatCurrency,
  calculateAccountBalances, calculateBudgetStatus, normalizeAmounts,
  analyzeGoal, getMonthTotals, safeDueDate, getDueOccurrences, nextDueDate,
} from './calculations';
import type { Account, Transaction, Income, Budget, Goal } from '@/types';

// ---- factories -------------------------------------------------------------
const acc = (o: Partial<Account>): Account => ({
  id: 'a', user_id: 'u', name: 'A', account_type: 'Bank Account', currency: 'INR',
  is_active: true, include_in_dashboard: true, include_in_goal_savings: false,
  is_credit_card: false, is_spendable: true, sort_order: 0, created_at: '', updated_at: '', ...o,
} as Account);

const tx = (o: Partial<Transaction>): Transaction => ({
  id: 't', user_id: 'u', date: '2026-03-01', amount: 0, type: 'expense',
  is_fixed_expense_auto: false, created_at: '', updated_at: '', ...o,
} as Transaction);

const inc = (o: Partial<Income>): Income => ({
  id: 'i', user_id: 'u', date: '2026-03-01', amount: 0, category: 'Salary',
  owner_purpose: 'Personal', to_account_id: '', include_in_true_income: true,
  created_at: '', updated_at: '', ...o,
} as Income);

const bud = (o: Partial<Budget>): Budget => ({
  id: 'b', user_id: 'u', category: 'Food', monthly_budget: 0, is_active: true,
  include_in_budget: true, effective_from: '2026-01-01', created_at: '', updated_at: '', ...o,
} as Budget);

const goal = (o: Partial<Goal>): Goal => ({
  id: 'g', user_id: 'u', name: 'G', priority: 3, expected_cost: 0, amount_allocated: 0,
  monthly_saving_plan: 0, is_active: true, created_at: '', updated_at: '', ...o,
} as Goal);

const RATES = { THB: 2.38, USD: 83 }; // value of 1 unit in base (INR)

// ============================================================
describe('convertAmount', () => {
  it('returns amount unchanged for same currency', () => {
    expect(convertAmount(1000, 'INR', 'INR', RATES, 'INR')).toBe(1000);
  });
  it('converts foreign → base', () => {
    expect(convertAmount(1000, 'THB', 'INR', RATES, 'INR')).toBeCloseTo(2380, 5);
  });
  it('converts base → foreign', () => {
    expect(convertAmount(2380, 'INR', 'THB', RATES, 'INR')).toBeCloseTo(1000, 5);
  });
  it('converts foreign → foreign through base', () => {
    // 100 USD -> base 8300 -> THB 8300/2.38
    expect(convertAmount(100, 'USD', 'THB', RATES, 'INR')).toBeCloseTo(8300 / 2.38, 4);
  });
  it('is a no-op when a rate is missing', () => {
    expect(convertAmount(100, 'XXX', 'INR', RATES, 'INR')).toBe(100);
    expect(convertAmount(100, 'INR', 'YYY', RATES, 'INR')).toBe(100);
  });
  it('is a no-op when rates are undefined', () => {
    expect(convertAmount(100, 'THB', 'INR', undefined, 'INR')).toBe(100);
  });
});

describe('currencyLabel / currencySymbol / formatCurrency', () => {
  it('labels a currency with a distinct symbol', () => {
    expect(currencyLabel('THB')).toBe('THB ฿');
    expect(currencyLabel('USD')).toBe('USD $');
  });
  it('does not duplicate when the symbol is just the code', () => {
    expect(currencyLabel('CHF')).toBe('CHF');   // CHF symbol is "CHF"
    expect(currencyLabel('XYZ')).toBe('XYZ');    // unknown
  });
  it('currencySymbol falls back to the code for unknowns', () => {
    expect(currencySymbol('THB')).toBe('฿');
    expect(currencySymbol('ZZZ')).toBe('ZZZ ');
  });
  it('formatCurrency guards NaN/Infinity', () => {
    expect(formatCurrency(NaN, '₹')).toBe('₹0');
    expect(formatCurrency(Infinity, '₹')).toBe('₹0');
  });
  it('formatCurrency renders negatives and compact', () => {
    expect(formatCurrency(-1234, '₹')).toBe('-₹1,234');
    expect(formatCurrency(150000, '₹', true)).toBe('₹1.5L');
    expect(formatCurrency(2500, '₹', true)).toBe('₹2.5K');
  });
});

// ============================================================
describe('calculateAccountBalances', () => {
  const bank = acc({ id: 'bank', name: 'Bank' });
  const sav = acc({ id: 'sav', name: 'Savings', include_in_goal_savings: true });
  const cc = acc({ id: 'cc', name: 'Card', is_credit_card: true });
  const accounts = [bank, sav, cc];

  it('applies every transaction type with correct signs', () => {
    const income = [inc({ to_account_id: 'bank', amount: 100000 })];
    const txns = [
      tx({ type: 'expense', from_account_id: 'bank', amount: 20000 }),
      tx({ type: 'transfer', from_account_id: 'bank', to_account_id: 'sav', amount: 10000 }),
      tx({ type: 'expense', from_account_id: 'cc', amount: 5000 }),         // CC spend → outstanding up
      tx({ type: 'credit_card_payment', from_account_id: 'bank', to_account_id: 'cc', amount: 5000 }),
      tx({ type: 'saving', from_account_id: 'bank', to_account_id: 'sav', amount: 5000 }),
    ];
    const bals = calculateAccountBalances(accounts, income, txns);
    const b = (id: string) => bals.find(x => x.account.id === id)!;
    expect(b('bank').balance).toBe(60000);  // 100000-20000-10000-5000-5000
    expect(b('sav').balance).toBe(15000);   // 10000+5000
    expect(b('cc').is_credit_card).toBe(true);
    expect(b('cc').outstanding).toBe(0);     // +5000 spend, -5000 payment
  });

  it('credit-card outstanding goes up on spend and down on payment', () => {
    const txns = [
      tx({ type: 'initial_cc_outstanding', from_account_id: 'cc', amount: 5000 }),
      tx({ type: 'expense', from_account_id: 'cc', amount: 8000 }),
      tx({ type: 'credit_card_payment', from_account_id: 'bank', to_account_id: 'cc', amount: 10000 }),
    ];
    const bals = calculateAccountBalances(accounts, [], txns);
    expect(bals.find(x => x.account.id === 'cc')!.outstanding).toBe(3000); // 5000+8000-10000
  });

  it('converts the destination leg of a CROSS-CURRENCY transfer', () => {
    const inr = acc({ id: 'inr', name: 'INR Bank', currency: 'INR' });
    const thb = acc({ id: 'thb', name: 'THB Cash', currency: 'THB' });
    const txns = [tx({ type: 'transfer', from_account_id: 'inr', to_account_id: 'thb', amount: 2380 })];
    // With rates+base: ₹2380 out, ฿1000 in (2380 / 2.38).
    const withRates = calculateAccountBalances([inr, thb], [], txns, RATES, 'INR');
    expect(withRates.find(x => x.account.id === 'thb')!.balance).toBeCloseTo(1000, 5);
    expect(withRates.find(x => x.account.id === 'inr')!.balance).toBe(-2380);
    // Without rates: no conversion (legacy behaviour).
    const noRates = calculateAccountBalances([inr, thb], [], txns);
    expect(noRates.find(x => x.account.id === 'thb')!.balance).toBe(2380);
  });
});

// ============================================================
describe('calculateBudgetStatus', () => {
  const statusDate = new Date(2026, 2, 15); // 15 Mar 2026, month has 31 days
  const budgets = [bud({ category: 'Food', monthly_budget: 30000 })];

  it('is green when spend is under the day-paced allowance', () => {
    const txns = [tx({ type: 'expense', category: 'Food', from_account_id: 'bank', amount: 10000, date: '2026-03-05' })];
    const [s] = calculateBudgetStatus(budgets, txns, [], statusDate, 3, 2026);
    expect(s.status).toBe('green');
    expect(s.actual_till_date).toBe(10000);
    expect(s.monthly_budget).toBe(30000);
    expect(s.remaining_monthly).toBe(20000);
    expect(Number.isFinite(s.projected_month_end)).toBe(true);
    expect(s.projected_month_end).toBeGreaterThanOrEqual(s.actual_till_date);
  });

  it('is red when discretionary spend runs ahead of pace', () => {
    const txns = [tx({ type: 'expense', category: 'Food', from_account_id: 'bank', amount: 25000, date: '2026-03-05' })];
    const [s] = calculateBudgetStatus(budgets, txns, [], statusDate, 3, 2026);
    expect(s.status).toBe('red');
  });

  it('is grey when the budget is zero', () => {
    const [s] = calculateBudgetStatus([bud({ category: 'Food', monthly_budget: 0 })], [], [], statusDate, 3, 2026);
    expect(s.status).toBe('grey');
  });
});

// ============================================================
describe('normalizeAmounts', () => {
  it('converts income (by to-account) and transactions (by from-account) into display currency', () => {
    const bank = acc({ id: 'bank', currency: 'INR' });
    const thb = acc({ id: 'thb', currency: 'THB' });
    const income = [inc({ to_account_id: 'thb', amount: 1000 })];          // ฿1000
    const txns = [tx({ type: 'expense', from_account_id: 'thb', amount: 100 })]; // ฿100
    const n = normalizeAmounts([bank, thb], income, txns, RATES, 'INR', 'INR');
    expect(n.income[0].amount).toBeCloseTo(2380, 5);     // ฿1000 → ₹2380
    expect(n.transactions[0].amount).toBeCloseTo(238, 5); // ฿100 → ₹238
    expect(n.accounts.every(a => a.currency === 'INR')).toBe(true);
  });
});

// ============================================================
describe('analyzeGoal', () => {
  it('computes progress, gap and months needed', () => {
    const a = analyzeGoal(goal({ expected_cost: 50000, monthly_saving_plan: 5000 }), 30000);
    expect(a.progress_percent).toBeCloseTo(60, 5);
    expect(a.can_buy_now).toBe(false);
    expect(a.remaining_gap).toBe(20000);
    expect(a.months_needed).toBe(4); // ceil(20000 / 5000)
  });
  it('guards a zero-cost goal (no divide-by-zero)', () => {
    const a = analyzeGoal(goal({ expected_cost: 0 }), 1000);
    expect(a.progress_percent).toBe(100);
    expect(Number.isFinite(a.progress_percent)).toBe(true);
    expect(a.can_buy_now).toBe(true);
  });
});

// ============================================================
describe('getMonthTotals', () => {
  it('sums income/expense/savings within a month', () => {
    const income = [
      inc({ date: '2026-03-10', amount: 90000, include_in_true_income: true }),
      inc({ date: '2026-03-20', amount: 5000, include_in_true_income: false }),
      inc({ date: '2026-02-10', amount: 1000 }), // other month, excluded
    ];
    const txns = [
      tx({ type: 'expense', date: '2026-03-05', amount: 20000 }),
      tx({ type: 'saving', date: '2026-03-06', amount: 10000 }),
      tx({ type: 'expense', date: '2026-04-01', amount: 999 }), // other month
    ];
    const t = getMonthTotals(income, txns, 3, 2026);
    expect(t.income).toBe(95000);
    expect(t.trueIncome).toBe(90000);
    expect(t.expense).toBe(20000);
    expect(t.savings).toBe(10000);
  });
});

// ============================================================
describe('recurring date helpers', () => {
  it('safeDueDate clamps to the real month length (incl. leap years)', () => {
    expect(safeDueDate(31, 2026, 1)).toBe('2026-02-28'); // Feb 2026 (not leap)
    expect(safeDueDate(31, 2024, 1)).toBe('2024-02-29'); // Feb 2024 (leap)
    expect(safeDueDate(15, 2026, 5)).toBe('2026-06-15');
    expect(safeDueDate(0, 2026, 5)).toBe('2026-06-01');  // clamps below 1 → 1
  });

  it('getDueOccurrences lists one per month from start up to asOf', () => {
    const occ = getDueOccurrences(
      { due_day: 10, start_date: '2026-01-10', end_date: undefined },
      new Date(2026, 2, 15) // 15 Mar 2026
    );
    expect(occ.map(o => o.period)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(occ[0].date).toBe('2026-01-10');
  });

  it('getDueOccurrences respects the end date', () => {
    const occ = getDueOccurrences(
      { due_day: 10, start_date: '2026-01-10', end_date: '2026-02-28' },
      new Date(2026, 5, 1)
    );
    expect(occ.map(o => o.period)).toEqual(['2026-01', '2026-02']);
  });

  it('nextDueDate returns the next occurrence after today', () => {
    const next = nextDueDate(
      { due_day: 10, start_date: '2026-01-01', end_date: undefined },
      new Date(2026, 2, 15) // 15 Mar — the 10th has passed
    );
    expect(next).toBe('2026-04-10');
  });
});
