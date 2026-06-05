import {
  Account, Income, Transaction, Budget, Goal, FixedExpense,
  AccountBalance, BudgetStatus, DashboardKPIs, GoalAnalysis,
  MonthlyTrend, CategorySpend, DateFilter, Alert, UserSettings
} from '@/types';
import { getDaysInMonth, format, parseISO, isWithinInterval, startOfMonth, endOfMonth } from 'date-fns';

// ============================================================
// ACCOUNT BALANCE CALCULATION
// Returns balance per account from all ledger entries
// Credit cards: positive = outstanding owed
// Normal accounts: positive = available balance
// ============================================================
export function calculateAccountBalances(
  accounts: Account[],
  income: Income[],
  transactions: Transaction[]
): AccountBalance[] {
  const balanceMap = new Map<string, number>();
  accounts.forEach(a => balanceMap.set(a.id, 0));

  // Income always credits the to_account
  income.forEach(inc => {
    const cur = balanceMap.get(inc.to_account_id) ?? 0;
    balanceMap.set(inc.to_account_id, cur + inc.amount);
  });

  // Transactions: complex logic per type
  transactions.forEach(tx => {
    switch (tx.type) {
      case 'expense': {
        // Debit from_account
        if (tx.from_account_id) {
          const cur = balanceMap.get(tx.from_account_id) ?? 0;
          balanceMap.set(tx.from_account_id, cur - tx.amount);
        }
        break;
      }
      case 'transfer': {
        // Debit from, credit to
        if (tx.from_account_id) {
          const cur = balanceMap.get(tx.from_account_id) ?? 0;
          balanceMap.set(tx.from_account_id, cur - tx.amount);
        }
        if (tx.to_account_id) {
          const cur = balanceMap.get(tx.to_account_id) ?? 0;
          balanceMap.set(tx.to_account_id, cur + tx.amount);
        }
        break;
      }
      case 'credit_card_payment': {
        // Bank decreases, CC outstanding decreases
        if (tx.from_account_id) {
          const cur = balanceMap.get(tx.from_account_id) ?? 0;
          balanceMap.set(tx.from_account_id, cur - tx.amount);
        }
        if (tx.to_account_id) {
          const cur = balanceMap.get(tx.to_account_id) ?? 0;
          // CC outstanding decreases (balance goes more positive / less negative)
          balanceMap.set(tx.to_account_id, cur - tx.amount);
        }
        break;
      }
      case 'saving': {
        // Debit source, credit savings
        if (tx.from_account_id) {
          const cur = balanceMap.get(tx.from_account_id) ?? 0;
          balanceMap.set(tx.from_account_id, cur - tx.amount);
        }
        if (tx.to_account_id) {
          const cur = balanceMap.get(tx.to_account_id) ?? 0;
          balanceMap.set(tx.to_account_id, cur + tx.amount);
        }
        break;
      }
      case 'initial_balance': {
        // Sets initial balance of normal account
        if (tx.to_account_id) {
          const cur = balanceMap.get(tx.to_account_id) ?? 0;
          balanceMap.set(tx.to_account_id, cur + tx.amount);
        }
        break;
      }
      case 'initial_cc_outstanding': {
        // Sets initial CC outstanding (stored as positive outstanding)
        if (tx.from_account_id) {
          const cur = balanceMap.get(tx.from_account_id) ?? 0;
          balanceMap.set(tx.from_account_id, cur + tx.amount);
        }
        break;
      }
      case 'adjustment': {
        // Manual correction: can be +/-
        if (tx.to_account_id) {
          const cur = balanceMap.get(tx.to_account_id) ?? 0;
          balanceMap.set(tx.to_account_id, cur + tx.amount);
        }
        if (tx.from_account_id && !tx.to_account_id) {
          const cur = balanceMap.get(tx.from_account_id) ?? 0;
          balanceMap.set(tx.from_account_id, cur - tx.amount);
        }
        break;
      }
    }
  });

  return accounts.map(account => {
    const raw = balanceMap.get(account.id) ?? 0;
    if (account.is_credit_card) {
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
  const total_bank_balance = balances
    .filter(b => !b.is_credit_card && b.account.is_active && b.account.include_in_dashboard)
    .reduce((s, b) => s + b.balance, 0);

  const spendable_balance = balances
    .filter(b => !b.is_credit_card && b.account.is_active && b.account.is_spendable)
    .reduce((s, b) => s + b.balance, 0);

  const savings_balance = balances
    .filter(b => !b.is_credit_card && b.account.is_active && b.account.include_in_goal_savings)
    .reduce((s, b) => s + b.balance, 0);

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

  // Upcoming fixed expenses (next 30 days)
  const today = new Date();
  const upcoming_fixed_expenses = fixedExpenses
    .filter(fe => fe.is_active && !fe.end_date || (fe.end_date && new Date(fe.end_date) > today))
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

// ============================================================
// NUMBER FORMATTERS
// ============================================================
export function formatCurrency(
  amount: number,
  symbol = '₹',
  compact = false
): string {
  if (compact && Math.abs(amount) >= 100000) {
    return `${symbol}${(amount / 100000).toFixed(1)}L`;
  }
  if (compact && Math.abs(amount) >= 1000) {
    return `${symbol}${(amount / 1000).toFixed(1)}K`;
  }
  return `${symbol}${Math.abs(amount).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}${amount < 0 ? ' (-)' : ''}`;
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
