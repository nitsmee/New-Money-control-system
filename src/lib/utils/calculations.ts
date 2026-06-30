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
  transactions: Transaction[],
  rates?: Record<string, number>,
  base?: string
): AccountBalance[] {
  const balanceMap = new Map<string, number>();
  accounts.forEach(a => balanceMap.set(a.id, 0));

  // Fast lookup: is this account id a credit card?
  const ccSet = new Set(accounts.filter(a => a.is_credit_card).map(a => a.id));
  const isCC = (id?: string | null) => !!id && ccSet.has(id);
  const curOf = (id?: string | null) => accounts.find(a => a.id === id)?.currency || base || '';

  // For a cross-currency movement, the destination leg must be credited in the
  // DESTINATION account's own currency. Convert from→to using stored rates.
  // When rates/base aren't supplied (most callers), this is a no-op.
  const toLeg = (amt: number, fromId?: string | null, toId?: string | null) =>
    (rates && base) ? convertAmount(amt, curOf(fromId), curOf(toId), rates, base) : amt;

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
        // From: CC outstanding up, bank down (source currency)
        add(tx.from_account_id, isCC(tx.from_account_id) ? tx.amount : -tx.amount);
        // To: credited in the destination's own currency (converted if different)
        const toAmt = toLeg(tx.amount, tx.from_account_id, tx.to_account_id);
        add(tx.to_account_id, isCC(tx.to_account_id) ? -toAmt : toAmt);
        break;
      }
      case 'credit_card_payment': {
        // Pay the card from a bank account.
        // Bank (from) goes down in its currency; CC (to) outstanding goes down
        // in the card's currency (converted if different).
        add(tx.from_account_id, isCC(tx.from_account_id) ? tx.amount : -tx.amount);
        add(tx.to_account_id, -toLeg(tx.amount, tx.from_account_id, tx.to_account_id));
        break;
      }
      case 'saving': {
        // From: CC outstanding up, bank down (source currency)
        add(tx.from_account_id, isCC(tx.from_account_id) ? tx.amount : -tx.amount);
        // To: savings bucket up in its own currency (converted if different)
        const toAmt = toLeg(tx.amount, tx.from_account_id, tx.to_account_id);
        add(tx.to_account_id, isCC(tx.to_account_id) ? -toAmt : toAmt);
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
  // Accounts whose "Show on Dashboard" toggle is off are excluded (Phase 4);
  // `!== false` means anything not explicitly turned off still counts.
  const spendable_balance = balances
    .filter(b => b.account.is_active && b.account.include_in_dashboard !== false && accountRole(b.account) === 'cash')
    .reduce((s, b) => s + b.balance, 0);

  const savings_balance = balances
    .filter(b => b.account.is_active && b.account.include_in_dashboard !== false && accountRole(b.account) === 'savings')
    .reduce((s, b) => s + b.balance, 0);

  // "Bank balance" = your own liquid money (cash + savings). Investments
  // and family/shared money are deliberately excluded so nothing is
  // double-counted.
  const total_bank_balance = spendable_balance + savings_balance;

  const total_cc_outstanding = balances
    .filter(b => b.is_credit_card && b.account.is_active && b.account.include_in_dashboard !== false)
    .reduce((s, b) => s + (b.outstanding ?? 0), 0);
  // Overpaid cards (raw < 0) hold a CREDIT balance — a real asset that the
  // clamped `outstanding` (>= 0) drops. Captured here so net worth adds it back.
  // (b.balance = -raw for a card → positive when overpaid.)
  const cc_credit_balance = balances
    .filter(b => b.is_credit_card && b.account.is_active && b.account.include_in_dashboard !== false)
    .reduce((s, b) => s + Math.max(0, b.balance), 0);

  // Period income
  const total_income = filteredIncome.reduce((s, i) => s + i.amount, 0);
  const true_income = filteredIncome
    .filter(i => i.include_in_true_income)
    .reduce((s, i) => s + i.amount, 0);

  // Period expenses
  const expenses = filteredTx.filter(t => t.type === 'expense');
  const total_expense = expenses.reduce((s, t) => s + t.amount, 0);
  // Family vs personal is derived from the ACCOUNT's role — money spent from a
  // family/shared account is family spending — with an owner-label fallback.
  // This no longer depends on exact hardcoded owner strings (F12), and every
  // expense lands in exactly one bucket, so the two always add up to the total.
  const familyAcctIds = new Set(accounts.filter(a => accountRole(a) === 'family').map(a => a.id));
  const isFamilyExpense = (t: Transaction) =>
    (!!t.from_account_id && familyAcctIds.has(t.from_account_id)) ||
    /family|shared|home|joint/i.test(t.owner_purpose ?? '');
  const family_expense = expenses.filter(isFamilyExpense).reduce((s, t) => s + t.amount, 0);
  const personal_expense = expenses.filter(t => !isFamilyExpense(t)).reduce((s, t) => s + t.amount, 0);

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
  // Upcoming = fixed expenses DUE in the selected month that have NOT been
  // posted yet. This excludes ones already paid this month (F5) and ones
  // whose charge falls in another month (F6) — so a SIP already taken this
  // month, or whose next date is next month, no longer inflates the figure.
  const targetYear = filter.year ?? today.getFullYear();
  const targetMonth = filter.month ?? today.getMonth() + 1;
  const targetPeriod = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;
  const postedFixedKeys = new Set(
    allTransactions
      .filter(t => t.fixed_expense_id && t.period)
      .map(t => `${t.fixed_expense_id}:${t.period}`)
  );
  const upcoming_fixed_expenses = fixedExpenses
    .filter(fe => {
      if (!fe.is_active) return false;
      const occ = safeDueDate(fe.due_day, targetYear, targetMonth - 1); // due date this month
      if (fe.start_date && occ < fe.start_date) return false;           // not started yet
      if (fe.end_date && occ > fe.end_date) return false;               // already ended
      return !postedFixedKeys.has(`${fe.id}:${targetPeriod}`);          // not already paid
    })
    .reduce((s, fe) => s + fe.amount, 0);

  // Safe to spend — reserve only BANK/cash-paid upcoming bills here. Bills
  // charged to a credit card are captured in the card outstanding when they
  // post, so reserving them here as well would double-count them (F8).
  const ccAcctIds = new Set(accounts.filter(a => a.is_credit_card).map(a => a.id));
  const bank_paid_upcoming = fixedExpenses
    .filter(fe => {
      if (!fe.is_active) return false;
      if (fe.from_account_id && ccAcctIds.has(fe.from_account_id)) return false; // card-charged -> skip
      const occ = safeDueDate(fe.due_day, targetYear, targetMonth - 1);
      if (fe.start_date && occ < fe.start_date) return false;
      if (fe.end_date && occ > fe.end_date) return false;
      return !postedFixedKeys.has(`${fe.id}:${targetPeriod}`);
    })
    .reduce((s, fe) => s + fe.amount, 0);

  // Keep the true value (can be negative) so every screen shows reality (F9).
  const safe_to_spend =
    spendable_balance - bank_paid_upcoming - total_cc_outstanding - settings.safe_spend_buffer;

  // Savings rate
  const savings_rate = true_income > 0 ? Math.min(100, (total_savings / true_income) * 100) : 0;

  // Month-over-month deltas — only meaningful for a specific calendar month view
  let mom_income_delta = 0, mom_expense_delta = 0, mom_savings_delta = 0;
  if (filter.view === 'monthly' && filter.month && filter.year) {
    const pm = filter.month === 1
      ? { month: 12, year: filter.year - 1 }
      : { month: filter.month - 1, year: filter.year };
    const prevTotals = getMonthTotals(allIncome, allTransactions, pm.month, pm.year);
    mom_income_delta = total_income - prevTotals.income;
    mom_expense_delta = total_expense - prevTotals.expense;
    mom_savings_delta = total_savings - prevTotals.savings;
  }

  return {
    total_bank_balance,
    spendable_balance,
    savings_balance,
    total_cc_outstanding,
    cc_credit_balance,
    total_income,
    true_income,
    total_expense,
    personal_expense,
    family_expense,
    total_savings,
    cc_bills_paid,
    net_cashflow,
    safe_to_spend,
    upcoming_fixed_expenses,
    upcoming_cc_dues: total_cc_outstanding,
    savings_rate,
    mom_income_delta,
    mom_expense_delta,
    mom_savings_delta,
  };
}

// ============================================================
// BUDGET STATUS CALCULATION
// ============================================================
export function calculateBudgetStatus(
  budgets: Budget[],
  transactions: Transaction[],
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
    const catTx = monthTx.filter(t => t.category === budget.category);
    const actual_till_date = catTx.reduce((s, t) => s + t.amount, 0);
    // Fixed bills already posted in this category this month (planned lump sums).
    const postedFixed = catTx
      .filter(t => t.is_fixed_expense_auto)
      .reduce((s, t) => s + t.amount, 0);
    const actualDiscretionary = actual_till_date - postedFixed;

    // The full month's expected fixed bills for this category (the ones that
    // post as expenses, occurring this month within their start/end window).
    // These are treated as lump sums, NOT spread across the days — so a bill
    // that lands on the 1st no longer makes the category look "overspent" (F11).
    const fixedMonthly = fixedExpenses
      .filter(fe => fe.is_active && fe.type !== 'saving' && fe.type !== 'investment' && fe.type !== 'transfer' && fe.category === budget.category)
      .filter(fe => {
        const occ = safeDueDate(fe.due_day, year, month - 1);
        if (fe.start_date && occ < fe.start_date) return false;
        if (fe.end_date && occ > fe.end_date) return false;
        return true;
      })
      .reduce((s, fe) => s + fe.amount, 0);

    // Only the discretionary part of the budget is paced day-by-day.
    const discretionaryMonthly = Math.max(0, budget.monthly_budget - fixedMonthly);
    const daily_budget = discretionaryMonthly / daysInMonth;
    const allowedDiscretionary = daily_budget * dayOfMonth;
    // Allowed so far = fixed bills already posted + the day-paced discretionary slice.
    const allowed_till_date = postedFixed + allowedDiscretionary;

    const remaining_monthly = budget.monthly_budget - actual_till_date;
    const overspent = Math.max(0, actual_till_date - allowed_till_date);
    const days_remaining = daysInMonth - dayOfMonth;
    const recovery_per_day = days_remaining > 0 && overspent > 0
      ? overspent / days_remaining : 0;

    let status: BudgetStatus['status'] = 'green';
    if (budget.monthly_budget === 0) status = 'grey';
    else if (actual_till_date > budget.monthly_budget) status = 'red';          // over the monthly limit
    else if (actualDiscretionary > allowedDiscretionary) status = 'red';        // discretionary spending ahead of pace
    else if (actualDiscretionary > allowedDiscretionary * 0.9) status = 'orange';
    else status = 'green';

    const daily_spend_rate = dayOfMonth > 0 ? actualDiscretionary / dayOfMonth : 0;
    // Forecast that blends your planned discretionary budget with your actual
    // pace. Early in the month we lean on the plan (so one big day-1 purchase
    // no longer extrapolates to the whole month); as the month progresses we
    // lean on real pace. Never projects below what you've already spent.
    const paceProjectedDiscretionary = daily_spend_rate * daysInMonth;
    const monthProgress = daysInMonth > 0 ? Math.min(1, dayOfMonth / daysInMonth) : 1;
    const blendedDiscretionary =
      monthProgress * paceProjectedDiscretionary + (1 - monthProgress) * discretionaryMonthly;
    const projected_month_end = postedFixed + Math.max(actualDiscretionary, blendedDiscretionary);

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
      projected_month_end,
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
  // Guard divide-by-zero: a zero-cost goal is trivially 100% funded.
  const progress_percent = goal.expected_cost > 0
    ? Math.min(100, (availableSaving / goal.expected_cost) * 100)
    : 100;

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
  settings: UserSettings,
  sym: string = '₹'
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
        message: `You've spent ${sym}${bs.actual_till_date.toLocaleString('en-IN')} of ${sym}${bs.monthly_budget.toLocaleString('en-IN')} budget (${sym}${(bs.actual_till_date - bs.monthly_budget).toLocaleString('en-IN')} over).`,
        severity: 'error',
        actionable: false,
      });
    } else if (bs.status === 'red') {
      alerts.push({
        id: `budget-ahead-${bs.category}`,
        type: 'budget_overspent',
        title: `Spending Ahead: ${bs.category}`,
        message: `Spent ${sym}${bs.actual_till_date.toLocaleString('en-IN')} vs ${sym}${bs.allowed_till_date.toFixed(0)} allowed till today. Recovery needed: ${sym}${bs.recovery_per_day.toFixed(0)}/day.`,
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
        message: `Account "${b.account.name}" has a negative balance of ${sym}${Math.abs(b.balance).toLocaleString('en-IN')}.`,
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
        message: `Outstanding of ${sym}${b.outstanding?.toLocaleString('en-IN')} on ${b.account.name}.`,
        severity: 'warning',
        actionable: false,
      });
    }
  });

  // Fixed expenses due soon (within 5 days). Clamp the due day to the real
  // month length so month-end bills (29–31) aren't mis-dated, and look across
  // the month boundary so a bill due early next month still alerts (F13).
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  fixedExpenses.filter(fe => fe.is_active).forEach(fe => {
    // This month's clamped occurrence (e.g. day 31 in June -> 30 June).
    let occStr = safeDueDate(fe.due_day, today.getFullYear(), today.getMonth());
    // If it has already passed, use next month's clamped occurrence instead.
    if (parseISO(occStr) < todayMidnight) {
      const ny = today.getMonth() === 11 ? today.getFullYear() + 1 : today.getFullYear();
      const nm = today.getMonth() === 11 ? 0 : today.getMonth() + 1;
      occStr = safeDueDate(fe.due_day, ny, nm);
    }
    if (fe.start_date && occStr < fe.start_date) return; // not started yet
    if (fe.end_date && occStr > fe.end_date) return;     // already ended
    const daysUntil = Math.ceil((parseISO(occStr).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntil >= 0 && daysUntil <= 5) {
      alerts.push({
        id: `fixed-due-${fe.id}`,
        type: 'fixed_expense_due',
        title: `Fixed Payment Due: ${fe.name}`,
        message: `${sym}${fe.amount.toLocaleString('en-IN')} due ${daysUntil === 0 ? 'today' : `in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`}.`,
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
  // Guard against NaN / Infinity leaking into the UI as "NaN"/"Infinity".
  if (!Number.isFinite(amount)) amount = 0;
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

// Time-of-day from an ISO timestamp (e.g. created_at) → "2:45 PM". Empty if invalid.
export function formatTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}

// ============================================================
// MULTI-CURRENCY
// ============================================================

export const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: '₹', THB: '฿', USD: '$', EUR: '€', GBP: '£', JPY: '¥',
  AED: 'د.إ', SGD: 'S$', AUD: 'A$', CAD: 'C$', MYR: 'RM', CNY: '¥',
  CHF: 'CHF', HKD: 'HK$', NZD: 'NZ$', LKR: 'Rs', NPR: 'रू',
};

export function currencySymbol(code?: string): string {
  if (!code) return '₹';
  return CURRENCY_SYMBOLS[code.toUpperCase()] ?? `${code.toUpperCase()} `;
}

// A clean dropdown/label string for a currency. Shows "THB ฿" when there's a
// distinct symbol, but just "CHF" when the symbol is only the code (avoids the
// "CHF CHF" double-name).
export function currencyLabel(code: string): string {
  const c = (code || '').toUpperCase();
  const sym = CURRENCY_SYMBOLS[c];
  return sym && sym.trim() !== c ? `${c} ${sym}` : c;
}

// Currencies the app can pick from (searchable in the UI).
export const CURRENCY_CODES = [
  'INR', 'THB', 'USD', 'EUR', 'GBP', 'JPY', 'AED', 'SGD', 'AUD', 'CAD',
  'MYR', 'CNY', 'CHF', 'HKD', 'NZD', 'LKR', 'NPR',
];

// Shared year list for date selectors — runs through 2060.
export const YEAR_OPTIONS: number[] = Array.from({ length: 2060 - 2023 + 1 }, (_, i) => 2023 + i);

// rates: value of 1 unit of a currency expressed IN the base currency.
// The base currency itself is implicitly 1.
export function convertAmount(
  amount: number,
  from: string,
  to: string,
  rates: Record<string, number> | undefined,
  base: string
): number {
  if (!from || !to || from === to) return amount;
  const r = rates ?? {};
  const rf = from === base ? 1 : r[from];
  const rt = to === base ? 1 : r[to];
  if (!rf || !rt) return amount; // unknown rate → best-effort, leave as-is
  return (amount * rf) / rt;
}

// Returns copies of accounts/income/transactions with every amount converted
// into `display` currency, so the existing single-currency calculation
// functions can be reused unchanged for cross-currency aggregate totals.
// A row's source currency is its account's currency (from-account for
// transactions, to-account for income).
export function normalizeAmounts(
  accounts: Account[],
  income: Income[],
  transactions: Transaction[],
  rates: Record<string, number> | undefined,
  base: string,
  display: string
): { accounts: Account[]; income: Income[]; transactions: Transaction[] } {
  const curOf = new Map(accounts.map(a => [a.id, a.currency || base]));
  const cur = (id?: string | null) => (id && curOf.get(id)) || base;
  return {
    accounts: accounts.map(a => ({ ...a, currency: display })),
    income: income.map(i => ({ ...i, amount: convertAmount(i.amount, cur(i.to_account_id), display, rates, base) })),
    transactions: transactions.map(t => ({
      ...t,
      amount: convertAmount(t.amount, cur(t.from_account_id ?? t.to_account_id), display, rates, base),
    })),
  };
}

// ============================================================
// ACCOUNT LEDGER — a running-balance statement for one account
// Every entry that touches the account, oldest → newest, with the
// signed effect (delta) and the running balance after it. The final
// `running` value equals this account's balance/outstanding, so a user
// can trace exactly how the current number was reached. Native currency.
// ============================================================
export interface LedgerEntry {
  id: string;
  date: string;
  label: string;
  type: string;       // transaction type, or 'income'
  delta: number;      // signed effect on this account (native currency)
  running: number;    // running balance after this entry
  isCreditCard: boolean;
}

export function accountLedger(
  accountId: string,
  accounts: Account[],
  income: Income[],
  transactions: Transaction[],
  rates?: Record<string, number>,
  base?: string
): LedgerEntry[] {
  const account = accounts.find(a => a.id === accountId);
  if (!account) return [];
  const isCC = !!account.is_credit_card;
  const curOf = (id?: string | null) => accounts.find(a => a.id === id)?.currency || base || '';
  // Convert a cross-currency leg INTO this account's currency.
  const toThis = (amt: number, fromId?: string | null) =>
    (rates && base) ? convertAmount(amt, curOf(fromId), curOf(accountId), rates, base) : amt;

  interface Ev { id: string; date: string; created_at: string; label: string; type: string; delta: number; }
  const events: Ev[] = [];

  income.filter(i => i.to_account_id === accountId).forEach(i => {
    events.push({ id: i.id, date: i.date, created_at: i.created_at ?? '', label: i.description || i.source || i.category || 'Income', type: 'income', delta: i.amount });
  });

  transactions.forEach(t => {
    const fromMe = t.from_account_id === accountId;
    const toMe = t.to_account_id === accountId;
    if (!fromMe && !toMe) return;
    let delta = 0;
    switch (t.type) {
      case 'expense': if (fromMe) delta = isCC ? t.amount : -t.amount; break;
      case 'transfer':
        if (fromMe) delta += isCC ? t.amount : -t.amount;
        if (toMe) { const v = toThis(t.amount, t.from_account_id); delta += isCC ? -v : v; }
        break;
      case 'credit_card_payment':
        if (fromMe) delta += isCC ? t.amount : -t.amount;
        if (toMe) delta += -toThis(t.amount, t.from_account_id);
        break;
      case 'saving':
        if (fromMe) delta += isCC ? t.amount : -t.amount;
        if (toMe) { const v = toThis(t.amount, t.from_account_id); delta += isCC ? -v : v; }
        break;
      case 'initial_balance': if (toMe) delta = t.amount; break;
      case 'initial_cc_outstanding': if (fromMe) delta = t.amount; break;
      case 'adjustment': if (toMe) delta = t.amount; else if (fromMe) delta = -t.amount; break;
    }
    events.push({ id: t.id, date: t.date, created_at: t.created_at ?? '', label: t.description || t.category || t.type.replace(/_/g, ' '), type: t.type, delta });
  });

  events.sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at));
  let running = 0;
  return events.map(e => {
    running += e.delta;
    return { id: e.id, date: e.date, label: e.label, type: e.type, delta: e.delta, running, isCreditCard: isCC };
  });
}

// ============================================================
// RUNNING BALANCE PER ENTRY
// For each income/transaction, the running balance of the PRIMARY account
// it affects, AFTER that entry — computed across the FULL history in
// chronological order. Lets every list show a bank-statement "balance after"
// that stays aligned with calculateAccountBalances / accountLedger.
// Primary account: income/initial_balance → to-account; everything else →
// from-account (falling back to to-account). Native currency of that account.
// ============================================================
export interface RunningInfo { accountId: string; currency: string; running: number; isCreditCard: boolean; }

function primaryAccountOf(t: Transaction): string | undefined {
  if (t.type === 'initial_balance') return t.to_account_id ?? undefined;
  if (t.type === 'adjustment') return (t.to_account_id ?? t.from_account_id) ?? undefined;
  return (t.from_account_id ?? t.to_account_id) ?? undefined;
}

export function runningBalanceByEntry(
  accounts: Account[],
  income: Income[],
  transactions: Transaction[],
  rates?: Record<string, number>,
  base?: string
): Map<string, RunningInfo> {
  const map = new Map<string, RunningInfo>();
  const ccSet = new Set(accounts.filter(a => a.is_credit_card).map(a => a.id));
  const isCC = (id?: string | null) => !!id && ccSet.has(id);
  const curOf = (id?: string | null) => accounts.find(a => a.id === id)?.currency || base || '';
  const toAcct = (amt: number, fromId?: string | null, toId?: string | null) =>
    (rates && base) ? convertAmount(amt, curOf(fromId), curOf(toId), rates, base) : amt;

  const bal = new Map<string, number>();
  accounts.forEach(a => bal.set(a.id, 0));
  const add = (id: string | null | undefined, delta: number) => { if (!id) return; bal.set(id, (bal.get(id) ?? 0) + delta); };

  interface Ev { id: string; date: string; created_at: string; kind: 'income' | 'tx'; ref: Income | Transaction; }
  const events: Ev[] = [
    ...income.map(i => ({ id: i.id, date: i.date, created_at: i.created_at ?? '', kind: 'income' as const, ref: i })),
    ...transactions.map(t => ({ id: t.id, date: t.date, created_at: t.created_at ?? '', kind: 'tx' as const, ref: t })),
  ];
  events.sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at));

  for (const ev of events) {
    let primary: string | undefined;
    if (ev.kind === 'income') {
      const i = ev.ref as Income;
      add(i.to_account_id, i.amount);
      primary = i.to_account_id || undefined;
    } else {
      const t = ev.ref as Transaction;
      switch (t.type) {
        case 'expense': add(t.from_account_id, isCC(t.from_account_id) ? t.amount : -t.amount); break;
        case 'transfer': {
          add(t.from_account_id, isCC(t.from_account_id) ? t.amount : -t.amount);
          const v = toAcct(t.amount, t.from_account_id, t.to_account_id);
          add(t.to_account_id, isCC(t.to_account_id) ? -v : v);
          break;
        }
        case 'credit_card_payment':
          add(t.from_account_id, isCC(t.from_account_id) ? t.amount : -t.amount);
          add(t.to_account_id, -toAcct(t.amount, t.from_account_id, t.to_account_id));
          break;
        case 'saving': {
          add(t.from_account_id, isCC(t.from_account_id) ? t.amount : -t.amount);
          const v = toAcct(t.amount, t.from_account_id, t.to_account_id);
          add(t.to_account_id, isCC(t.to_account_id) ? -v : v);
          break;
        }
        case 'initial_balance': add(t.to_account_id, t.amount); break;
        case 'initial_cc_outstanding': add(t.from_account_id, t.amount); break;
        case 'adjustment': if (t.to_account_id) add(t.to_account_id, t.amount); else if (t.from_account_id) add(t.from_account_id, -t.amount); break;
      }
      primary = primaryAccountOf(t);
    }
    if (primary) {
      map.set(ev.id, { accountId: primary, currency: curOf(primary), running: bal.get(primary) ?? 0, isCreditCard: isCC(primary) });
    }
  }
  return map;
}

// ============================================================
// BALANCE-LIMIT WARNINGS (soft validation — warn, never block)
// Returns warnings if a NEW entry would overdraw a normal account
// (projected balance < 0, unless the account's overdraft_warn is false) or push
// a credit card over its credit_limit. Forward-compatible: credit_limit /
// overdraft_warn are optional and simply skipped when unset.
// ============================================================
export interface EntryWarning {
  kind: 'overdraft' | 'over_limit';
  accountId: string;
  accountName: string;
  currency: string;
  current: number;    // current balance (overdraft) or outstanding (over_limit)
  amount: number;     // the entry amount
  projected: number;  // resulting balance / outstanding
  limit?: number;     // credit limit (over_limit only)
}

export function checkEntryWarnings(
  entry: { type: string; amount: number; from_account_id?: string | null; to_account_id?: string | null },
  balances: AccountBalance[],
  baseCurrency = 'INR',
): EntryWarning[] {
  const amt = +entry.amount || 0;
  if (amt <= 0) return [];
  const byId = new Map(balances.map(b => [b.account.id, b]));
  const out: EntryWarning[] = [];
  const fromB = entry.from_account_id ? byId.get(entry.from_account_id) : undefined;
  const debits = entry.type === 'expense' || entry.type === 'transfer' || entry.type === 'saving' || entry.type === 'credit_card_payment';

  if (fromB && debits) {
    const cur = fromB.account.currency || baseCurrency;
    if (fromB.is_credit_card) {
      // Spending on a credit card raises what you owe → over-limit check.
      if (entry.type === 'expense') {
        const limit = fromB.account.credit_limit ?? 0;
        const projected = (fromB.outstanding ?? 0) + amt;
        if (limit > 0 && projected > limit) {
          out.push({ kind: 'over_limit', accountId: fromB.account.id, accountName: fromB.account.name, currency: cur, current: fromB.outstanding ?? 0, amount: amt, projected, limit });
        }
      }
    } else if (fromB.account.overdraft_warn !== false) {
      // Normal account: balance decreases.
      const projected = fromB.balance - amt;
      if (projected < 0) {
        out.push({ kind: 'overdraft', accountId: fromB.account.id, accountName: fromB.account.name, currency: cur, current: fromB.balance, amount: amt, projected });
      }
    }
  }

  // Setting an opening credit-card balance above its limit.
  if (entry.type === 'initial_cc_outstanding' && fromB?.is_credit_card) {
    const limit = fromB.account.credit_limit ?? 0;
    if (limit > 0 && amt > limit) {
      out.push({ kind: 'over_limit', accountId: fromB.account.id, accountName: fromB.account.name, currency: fromB.account.currency || baseCurrency, current: 0, amount: amt, projected: amt, limit });
    }
  }
  return out;
}

// ============================================================
// MONTH-OVER-MONTH COMPARISON
// ============================================================
export function getMonthTotals(
  income: Income[],
  transactions: Transaction[],
  month: number,
  year: number
): { income: number; expense: number; savings: number; trueIncome: number } {
  const start = `${year}-${String(month).padStart(2,'0')}-01`;
  const end = format(endOfMonth(new Date(year, month - 1)), 'yyyy-MM-dd');
  const mIncome = income.filter(i => i.date >= start && i.date <= end).reduce((s,i) => s+i.amount, 0);
  const mTrueIncome = income.filter(i => i.date >= start && i.date <= end && i.include_in_true_income).reduce((s,i) => s+i.amount, 0);
  const mExpense = transactions.filter(t => t.type==='expense' && t.date >= start && t.date <= end).reduce((s,t) => s+t.amount, 0);
  const mSavings = transactions.filter(t => t.type==='saving' && t.date >= start && t.date <= end).reduce((s,t) => s+t.amount, 0);
  return { income: mIncome, expense: mExpense, savings: mSavings, trueIncome: mTrueIncome };
}
