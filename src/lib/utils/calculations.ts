import {
  Account, Income, Transaction, Budget, Goal, FixedExpense,
  AccountBalance, BudgetStatus, DashboardKPIs, GoalAnalysis,
  MonthlyTrend, CategorySpend, DateFilter, Alert, UserSettings
} from '@/types';
import { getDaysInMonth, format, parseISO, isWithinInterval, startOfMonth, endOfMonth } from 'date-fns';

// ============================================================
// ACCOUNT ROLE — one role per account drives every total, so the
// same money is never counted in two places (Group A).
//   cash        -> spendable money you can use now
//   savings     -> money set aside (savings buckets)
//   investment  -> long-term (SIP, mutual funds, stocks) — net worth only
//   family      -> household / shared money, kept apart from "yours"
//   credit_card -> a liability (outstanding owed)
// Derived from the account's type/flags so nothing extra is required.
// ============================================================
export type AccountRole = 'cash' | 'savings' | 'investment' | 'family' | 'credit_card';

export function accountRole(a: Account): AccountRole {
  if (a.is_credit_card) return 'credit_card';
  const t = (a.account_type || '').toLowerCase();
  const o = (a.owner_purpose || '').toLowerCase();
  if (/invest|long.?term|mutual|stock|equit|brokerage|demat|sip/.test(t)) return 'investment';
  if (/family|shared|joint/.test(t) || /family|shared/.test(o)) return 'family';
  if (/saving/.test(t) || a.include_in_goal_savings) return 'savings';
  return 'cash';
}

// ============================================================
// ACCOUNT BALANCE CALCULATION
// Returns balance per account from all ledger entries.
//
// Sign convention for the internal `raw` value:
//   • Normal accounts -> positive = money available
//   • Credit cards    -> positive = outstanding owed
//
// A credit card's outstanding therefore INCREASES when you spend
// on it and DECREASES when you pay the bill. The previous version
// treated an expense from a CC the same as an expense from a bank
// (subtracting), which pushed the CC raw value negative and made
// `outstanding` clamp to 0 — the "CC always shows -₹0" bug.
// ============================================================
export function calculateAccountBalances(
  accounts: Account[],
  income: Income[],
  transactions: Transaction[]
): AccountBalance[] {
  const balanceMap = new Map<string, number>();
  accounts.forEach(a => balanceMap.set(a.id, 0));

  // Fast lookup: is this account id a credit card?
  const ccSet = new Set(accounts.filter(a => a.is_credit_card).map(a => a.id));
  const isCC = (id?: string | null) => !!id && ccSet.has(id);

  const add = (id: string | null | undefined, delta: number) => {
    if (!id) return;
    balanceMap.set(id, (balanceMap.get(id) ?? 0) + delta);
  };

  // Income always credits the to_account
  income.forEach(inc => add(inc.to_account_id, inc.amount));

  // Transactions: per-type logic, now CC-aware
  transactions.forEach(tx => {
    switch (tx.type) {
      case 'expense': {
        // CC spend -> outstanding goes UP (+). Bank spend -> balance goes DOWN (−).
        add(tx.from_account_id, isCC(tx.from_account_id) ? tx.amount : -tx.amount);
        break;
      }
      case 'transfer': {
        // From: CC outstanding up, bank down
        add(tx.from_account_id, isCC(tx.from_account_id) ? tx.amount : -tx.amount);
        // To: CC outstanding down, bank up
        add(tx.to_account_id, isCC(tx.to_account_id) ? -tx.amount : tx.amount);
        break;
      }
      case 'credit_card_payment': {
        // Pay the card from a bank account.
        // Bank (from) goes down; CC (to) outstanding goes down.
        add(tx.from_account_id, -tx.amount);
        add(tx.to_account_id, -tx.amount);
        break;
      }
      case 'saving': {
        // From: CC outstanding up, bank down
        add(tx.from_account_id, isCC(tx.from_account_id) ? tx.amount : -tx.amount);
        // To: a savings bucket (bank) goes up; if somehow a CC, outstanding down
        add(tx.to_account_id, isCC(tx.to_account_id) ? -tx.amount : tx.amount);
        break;
      }
      case 'initial_balance': {
        // Sets opening balance of a normal account
        add(tx.to_account_id, tx.amount);
        break;
      }
      case 'initial_cc_outstanding': {
        // Opening outstanding on a CC (positive owed)
        add(tx.from_account_id, tx.amount);
        break;
      }
      case 'adjustment': {
        // Manual correction
        if (tx.to_account_id) add(tx.to_account_id, tx.amount);
        else if (tx.from_account_id) add(tx.from_account_id, -tx.amount);
        break;
      }
    }
  });

  return accounts.map(account => {
    const raw = balanceMap.get(account.id) ?? 0;
    if (account.is_credit_card) {
      // raw is the outstanding owed (positive = owe money).
      // balance kept negative for any caller that reads it directly.
      return { account, balance: -raw, is_credit_card: true, outstanding: raw > 0 ? raw : 0 };
    }
    return { account, balance: raw, is_credit_card: false };
  });
}

// ============================================================
// FILTER TRANSACTIONS BY DATE RANGE
// ============================================================
export function filterByDateRange(
  items: (Transaction | Income)[],
  filter: DateFilter
): (Transaction | Income)[] {
  if (filter.view === 'monthly' && filter.month && filter.year) {
    const start = `${filter.year}-${String(filter.month).padStart(2, '0')}-01`;
    const end = format(endOfMonth(new Date(filter.year, filter.month - 1)), 'yyyy-MM-dd');
    return items.filter(i => i.date >= start && i.date <= end);
  }
  if (filter.view === 'yearly' && filter.year) {
    const start = `${filter.year}-01-01`;
    const end = `${filter.year}-12-31`;
    return items.filter(i => i.date >= start && i.date <= end);
  }
  if (filter.view === 'custom' && filter.start_date && filter.end_date) {
    return items.filter(i => i.date >= filter.start_date! && i.date <= filter.end_date!);
  }
  return items;
}

// ============================================================
// DASHBOARD KPI CALCULATION
// ============================================================
export function calculateDashboardKPIs(
  accounts: Account[],
  allIncome: Income[],
  allTransactions: Transaction[],
  fixedExpenses: FixedExpense[],
  filter: DateFilter,
  settings: UserSettings
): DashboardKPIs {
  const balances = calculateAccountBalances(accounts, allIncome, allTransactions);
  const filteredIncome = filterByDateRange(allIncome, filter) as Income[];
  const filteredTx = filterByDateRange(allTransactions, filter) as Transaction[];

  // Account balance totals
  // Role-based, non-overlapping totals (Group A): each account counts once.
  const spendable_balance = balances
    .filter(b => b.account.is_active && accountRole(b.account) === 'cash')
    .reduce((s, b) => s + b.balance, 0);

  const savings_balance = balances
    .filter(b => b.account.is_active && accountRole(b.account) === 'savings')
    .reduce((s, b) => s + b.balance, 0);

  // "Bank balance" = your own liquid money (cash + savings). Investments
  // and family/shared money are deliberately excluded so nothing is
  // double-counted.
  const total_bank_balance = spendable_balance + savings_balance;

  const total_cc_outstanding = balances
    .filter(b => b.is_credit_card && b.account.is_active)
    .reduce((s, b) => s + (b.outstanding ?? 0), 0);

  // Period income
  const total_income = filteredIncome.reduce((s, i) => s + i.amount, 0);
  const true_income = filteredIncome
    .filter(i => i.include_in_true_income)
    .reduce((s, i) => s + i.amount, 0);

  // Period expenses
  const expenses = filteredTx.filter(t => t.type === 'expense');
  const total_expense = expenses.reduce((s, t) => s + t.amount, 0);
  const personal_expense = expenses
    .filter(t => t.owner_purpose === 'Personal')
    .reduce((s, t) => s + t.amount, 0);
  const family_expense = expenses
    .filter(t => ['Family / Home', 'Family/Home', 'Shared'].includes(t.owner_purpose ?? ''))
    .reduce((s, t) => s + t.amount, 0);

  // Savings
  const total_savings = filteredTx
    .filter(t => t.type === 'saving')
    .reduce((s, t) => s + t.amount, 0);

  // CC payments
  const cc_bills_paid = filteredTx
    .filter(t => t.type === 'credit_card_payment')
    .reduce((s, t) => s + t.amount, 0);

  // Net cashflow
  const net_cashflow = total_income - total_expense - total_savings;

  // Upcoming fixed expenses (still active, not yet ended).
  // FIX: previously the end_date branch dropped the is_active check
  // (precedence bug), so inactive-but-future-dated rows leaked in.
  const today = new Date();
  const upcoming_fixed_expenses = fixedExpenses
    .filter(fe => fe.is_active && (!fe.end_date || new Date(fe.end_date) > today))
    .reduce((s, fe) => s + fe.amount, 0);

  // Remaining budget
  const remaining_budget = 0; // calculated separately in budget module

  // Safe to spend
  const safe_to_spend = Math.max(
    0,
    spendable_balance - upcoming_fixed_expenses - total_cc_outstanding - settings.safe_spend_buffer
  );

  return {
    total_bank_balance,
    spendable_balance,
    savings_balance,
    total_cc_outstanding,
    total_income,
    true_income,
    total_expense,
    personal_expense,
    family_expense,
    total_savings,
    cc_bills_paid,
    net_cashflow,
    safe_to_spend,
    remaining_budget,
    upcoming_fixed_expenses,
    upcoming_cc_dues: total_cc_outstanding,
  };
}

// ============================================================
// BUDGET STATUS CALCULATION
// ============================================================
export function calculateBudgetStatus(
  budgets: Budget[],
  transactions: Transaction[],
  income: Income[],
  fixedExpenses: FixedExpense[],
  statusDate: Date,
  month: number,
  year: number
): BudgetStatus[] {
  const daysInMonth = getDaysInMonth(new Date(year, month - 1));
  const dayOfMonth = statusDate.getMonth() + 1 === month && statusDate.getFullYear() === year
    ? statusDate.getDate()
    : daysInMonth;

  const startStr = `${year}-${String(month).padStart(2, '0')}-01`;
  const statusStr = `${year}-${String(month).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`;

  const monthTx = transactions.filter(t =>
    t.type === 'expense' && t.date >= startStr && t.date <= statusStr
  );

  return budgets.filter(b => b.is_active && b.include_in_budget).map(budget => {
    const daily_budget = budget.monthly_budget / daysInMonth;
    const allowed_till_date = daily_budget * dayOfMonth;
    const actual_till_date = monthTx
      .filter(t => t.category === budget.category)
      .reduce((s, t) => s + t.amount, 0);

    const remaining_monthly = budget.monthly_budget - actual_till_date;
    const overspent = Math.max(0, actual_till_date - allowed_till_date);
    const days_remaining = daysInMonth - dayOfMonth;
    const recovery_per_day = days_remaining > 0 && overspent > 0
      ? overspent / days_remaining : 0;

    let status: BudgetStatus['status'] = 'green';
    if (budget.monthly_budget === 0) status = 'grey';
    else if (actual_till_date > budget.monthly_budget) status = 'red';
    else if (actual_till_date > allowed_till_date) status = 'red';
    else if (actual_till_date > allowed_till_date * 0.9) status = 'orange';
    else status = 'green';

    return {
      category: budget.category,
      monthly_budget: budget.monthly_budget,
      daily_budget,
      allowed_till_date,
      actual_till_date,
      remaining_monthly,
      overspent,
      recovery_per_day,
      status,
      days_in_month: daysInMonth,
      days_elapsed: dayOfMonth,
      days_remaining,
      budget_entry: budget,
    };
  });
}

// ============================================================
// GOAL ANALYSIS
// ============================================================
export function analyzeGoal(goal: Goal, availableSaving: number): GoalAnalysis {
  const remaining_gap = Math.max(0, goal.expected_cost - availableSaving);
  const can_buy_now = availableSaving >= goal.expected_cost;
  const progress_percent = Math.min(100, (availableSaving / goal.expected_cost) * 100);

  let months_needed = 0;
  if (!can_buy_now && goal.monthly_saving_plan > 0) {
    months_needed = Math.ceil(remaining_gap / goal.monthly_saving_plan);
  } else if (!can_buy_now) {
    months_needed = 9999;
  }

  let risk_level: GoalAnalysis['risk_level'] = 'not_ready';
  let suggested_action = '';

  if (can_buy_now) {
    risk_level = availableSaving > goal.expected_cost * 1.5 ? 'safe' : 'moderate';
    suggested_action = 'You can purchase now. Ensure emergency buffer remains intact.';
  } else if (months_needed <= 6) {
    risk_level = 'moderate';
    suggested_action = `Keep saving ₹${goal.monthly_saving_plan.toLocaleString('en-IN')}/month. Ready in ~${months_needed} months.`;
  } else if (months_needed <= 24) {
    risk_level = 'moderate';
    suggested_action = `Long savings journey. Consider increasing monthly plan or a partial payment plan.`;
  } else {
    risk_level = 'not_ready';
    suggested_action = `Significant gap. Build a dedicated saving plan or explore EMI options.`;
  }

  return {
    goal,
    available_saving: availableSaving,
    remaining_gap,
    can_buy_now,
    months_needed,
    risk_level,
    suggested_action,
    progress_percent,
  };
}

// ============================================================
// MONTHLY TREND DATA
// ============================================================
export function buildMonthlyTrends(
  income: Income[],
  transactions: Transaction[],
  months: number = 12
): MonthlyTrend[] {
  const trends: MonthlyTrend[] = [];
  const now = new Date();

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const end = format(endOfMonth(d), 'yyyy-MM-dd');

    const mIncome = income.filter(x => x.date >= start && x.date <= end).reduce((s, x) => s + x.amount, 0);
    const mExpense = transactions.filter(t => t.type === 'expense' && t.date >= start && t.date <= end).reduce((s, t) => s + t.amount, 0);
    const mSavings = transactions.filter(t => t.type === 'saving' && t.date >= start && t.date <= end).reduce((s, t) => s + t.amount, 0);

    trends.push({
      month: format(d, 'MMM'),
      year: y,
      income: mIncome,
      expense: mExpense,
      savings: mSavings,
      net: mIncome - mExpense - mSavings,
    });
  }
  return trends;
}

// ============================================================
// CATEGORY SPEND BREAKDOWN
// ============================================================
export function getCategorySpend(
  transactions: Transaction[],
  categories: { name: string; color: string }[]
): CategorySpend[] {
  const expenses = transactions.filter(t => t.type === 'expense');
  const total = expenses.reduce((s, t) => s + t.amount, 0);
  const map = new Map<string, { amount: number; count: number }>();

  expenses.forEach(t => {
    const cat = t.category ?? 'Uncategorised';
    const cur = map.get(cat) ?? { amount: 0, count: 0 };
    map.set(cat, { amount: cur.amount + t.amount, count: cur.count + 1 });
  });

  const catColorMap = new Map(categories.map(c => [c.name, c.color]));

  return Array.from(map.entries())
    .map(([category, { amount, count }]) => ({
      category,
      amount,
      count,
      percent: total > 0 ? (amount / total) * 100 : 0,
      color: catColorMap.get(category) ?? '#94a3b8',
    }))
    .sort((a, b) => b.amount - a.amount);
}

// ============================================================
// ALERTS GENERATION
// ============================================================
export function generateAlerts(
  budgetStatuses: BudgetStatus[],
  balances: AccountBalance[],
  fixedExpenses: FixedExpense[],
  settings: UserSettings
): Alert[] {
  const alerts: Alert[] = [];
  const today = new Date();

  // Budget exceeded
  budgetStatuses.forEach(bs => {
    if (bs.status === 'red' && bs.actual_till_date > bs.monthly_budget) {
      alerts.push({
        id: `budget-exceeded-${bs.category}`,
        type: 'budget_exceeded',
        title: `Budget Exceeded: ${bs.category}`,
        message: `You've spent ₹${bs.actual_till_date.toLocaleString('en-IN')} of ₹${bs.monthly_budget.toLocaleString('en-IN')} budget (₹${(bs.actual_till_date - bs.monthly_budget).toLocaleString('en-IN')} over).`,
        severity: 'error',
        actionable: false,
      });
    } else if (bs.status === 'red') {
      alerts.push({
        id: `budget-ahead-${bs.category}`,
        type: 'budget_overspent',
        title: `Spending Ahead: ${bs.category}`,
        message: `Spent ₹${bs.actual_till_date.toLocaleString('en-IN')} vs ₹${bs.allowed_till_date.toFixed(0)} allowed till today. Recovery needed: ₹${bs.recovery_per_day.toFixed(0)}/day.`,
        severity: 'warning',
        actionable: false,
      });
    }
  });

  // Negative balance
  balances.forEach(b => {
    if (!b.is_credit_card && b.balance < 0) {
      alerts.push({
        id: `negative-${b.account.id}`,
        type: 'negative_balance',
        title: `Negative Balance: ${b.account.name}`,
        message: `Account "${b.account.name}" has a negative balance of ₹${Math.abs(b.balance).toLocaleString('en-IN')}.`,
        severity: 'error',
        actionable: false,
      });
    }
  });

  // High CC outstanding
  balances.forEach(b => {
    if (b.is_credit_card && (b.outstanding ?? 0) > 10000) {
      alerts.push({
        id: `cc-high-${b.account.id}`,
        type: 'high_cc_outstanding',
        title: `High Credit Card Balance: ${b.account.name}`,
        message: `Outstanding of ₹${b.outstanding?.toLocaleString('en-IN')} on ${b.account.name}.`,
        severity: 'warning',
        actionable: false,
      });
    }
  });

  // Fixed expenses due soon (within 5 days)
  fixedExpenses.filter(fe => fe.is_active).forEach(fe => {
    const dueThisMonth = new Date(today.getFullYear(), today.getMonth(), fe.due_day);
    const daysUntil = Math.ceil((dueThisMonth.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntil >= 0 && daysUntil <= 5) {
      alerts.push({
        id: `fixed-due-${fe.id}`,
        type: 'fixed_expense_due',
        title: `Fixed Payment Due: ${fe.name}`,
        message: `₹${fe.amount.toLocaleString('en-IN')} due in ${daysUntil === 0 ? 'today' : `${daysUntil} days`}.`,
        severity: daysUntil === 0 ? 'error' : 'warning',
        actionable: false,
      });
    }
  });

  return alerts;
}

// ============================================================
// FIXED EXPENSE: Check if already processed this period
// ============================================================
export function isFixedExpenseProcessed(fe: FixedExpense, period: string): boolean {
  return fe.last_processed_period === period;
}

export function getCurrentPeriod(date?: Date): string {
  const d = date ?? new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Build a safe transaction date for a fixed expense in a given month,
// clamping the due day to the number of days the month actually has.
// Prevents invalid dates like 2026-06-31 that Postgres rejects.
export function safeDueDate(dueDay: number, year: number, monthIndexZeroBased: number): string {
  const dim = getDaysInMonth(new Date(year, monthIndexZeroBased));
  const day = Math.min(Math.max(1, dueDay), dim);
  return `${year}-${String(monthIndexZeroBased + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export interface DueOccurrence { period: string; date: string; }

// Every due date for a fixed expense from its start date up to `asOf`,
// respecting the end date. One occurrence per month on the due day,
// clamped to the real month length. Pure string-date math, so no
// timezone surprises. Used by the auto-processor to back-fill missed
// months and to keep posting as each new due date arrives.
export function getDueOccurrences(
  fe: Pick<FixedExpense, 'due_day' | 'start_date' | 'end_date'>,
  asOf: Date = new Date()
): DueOccurrence[] {
  const out: DueOccurrence[] = [];
  if (!fe.start_date) return out;
  const asOfStr = `${asOf.getFullYear()}-${String(asOf.getMonth() + 1).padStart(2, '0')}-${String(asOf.getDate()).padStart(2, '0')}`;
  const endStr = fe.end_date || null;
  const [sy, sm] = fe.start_date.split('-').map(Number);
  let y = sy, m = sm; // m is 1-based
  for (let i = 0; i < 1200; i++) {
    const dim = getDaysInMonth(new Date(y, m - 1));
    const day = Math.min(Math.max(1, fe.due_day), dim);
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (endStr && dateStr > endStr) break;   // past the end date -> stop forever
    if (dateStr > asOfStr) break;            // not due yet -> stop
    if (dateStr >= fe.start_date) {
      out.push({ period: `${y}-${String(m).padStart(2, '0')}`, date: dateStr });
    }
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

// The next date this fixed expense will be charged on/after `today`,
// or null if it has already ended. Used for the "Next due" label.
export function nextDueDate(
  fe: Pick<FixedExpense, 'due_day' | 'start_date' | 'end_date'>,
  today: Date = new Date()
): string | null {
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const endStr = fe.end_date || null;
  let y = today.getFullYear(), m = today.getMonth() + 1;
  for (let i = 0; i < 24; i++) {
    const dim = getDaysInMonth(new Date(y, m - 1));
    const day = Math.min(Math.max(1, fe.due_day), dim);
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (endStr && dateStr > endStr) return null;
    if (dateStr >= todayStr && dateStr >= fe.start_date) return dateStr;
    m++; if (m > 12) { m = 1; y++; }
  }
  return null;
}

// ============================================================
// NUMBER FORMATTERS
// ============================================================
export function formatCurrency(
  amount: number,
  symbol = '₹',
  compact = false
): string {
  // FIX: render negatives as "-₹1,234" instead of "₹1,234 (-)".
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  if (compact && abs >= 100000) {
    return `${sign}${symbol}${(abs / 100000).toFixed(1)}L`;
  }
  if (compact && abs >= 1000) {
    return `${sign}${symbol}${(abs / 1000).toFixed(1)}K`;
  }
  return `${sign}${symbol}${abs.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function formatDate(dateStr: string, fmt = 'dd-MMM-yyyy'): string {
  try {
    return format(parseISO(dateStr), fmt);
  } catch {
    return dateStr;
  }
}

export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}
