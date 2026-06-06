// ============================================================
// MONEY CONTROL SYSTEM — Complete TypeScript Types
// ============================================================

// --- Core Enums & Constants ---

export type TransactionType =
  | 'expense'
  | 'transfer'
  | 'credit_card_payment'
  | 'saving'
  | 'initial_balance'
  | 'initial_cc_outstanding'
  | 'adjustment';

export type CategoryType = 'income' | 'expense' | 'transfer' | 'saving' | 'all';

export type Theme = 'light' | 'dark' | 'system';

export type FontChoice = 'dm-sans' | 'nunito' | 'inter' | 'outfit' | 'poppins';

export type DashboardView = 'monthly' | 'yearly' | 'custom';

export type AlertSeverity = 'info' | 'warning' | 'error' | 'success';

export type FixedExpenseType = 'expense' | 'saving' | 'investment' | 'transfer';

export const TRANSACTION_TYPES: { value: TransactionType; label: string }[] = [
  { value: 'expense', label: 'Expense' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'credit_card_payment', label: 'Credit Card Bill Payment' },
  { value: 'saving', label: 'Saving' },
  { value: 'initial_balance', label: 'Initial Balance' },
  { value: 'initial_cc_outstanding', label: 'Initial CC Outstanding' },
  { value: 'adjustment', label: 'Adjustment' },
];

export const PRIORITY_LABELS: Record<number, string> = {
  1: 'Critical',
  2: 'High',
  3: 'Medium',
  4: 'Low',
  5: 'Optional',
};

// --- Database Models ---

export interface AccountType {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Account {
  id: string;
  user_id: string;
  name: string;
  account_type: string;
  owner_purpose?: string;
  is_active: boolean;
  include_in_dashboard: boolean;
  include_in_goal_savings: boolean;
  is_credit_card: boolean;
  is_spendable: boolean;
  notes?: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  // computed
  computed_balance?: number;
}

export interface Owner {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  color: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  user_id: string;
  name: string;
  type: CategoryType;
  include_in_budget: boolean;
  color: string;
  icon: string;
  default_account_id?: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface IncomeSource {
  id: string;
  user_id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

export interface Income {
  id: string;
  user_id: string;
  date: string;
  amount: number;
  source?: string;
  category: string;
  owner_purpose: string;
  to_account_id: string;
  notes?: string;
  include_in_true_income: boolean;
  created_at: string;
  updated_at: string;
  // joined
  to_account?: Account;
}

export interface Transaction {
  id: string;
  user_id: string;
  date: string;
  amount: number;
  description?: string;
  type: TransactionType;
  category?: string;
  owner_purpose?: string;
  from_account_id?: string;
  to_account_id?: string;
  notes?: string;
  is_fixed_expense_auto: boolean;
  fixed_expense_id?: string;
  period?: string;
  created_at: string;
  updated_at: string;
  // joined
  from_account?: Account;
  to_account?: Account;
}

export interface FixedExpense {
  id: string;
  user_id: string;
  name: string;
  amount: number;
  type: FixedExpenseType;
  category?: string;
  owner_purpose?: string;
  from_account_id?: string;
  to_account_id?: string;
  due_day: number;
  start_date: string;
  end_date?: string;
  is_active: boolean;
  auto_count: boolean;
  last_processed_period?: string;
  notes?: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  // joined
  from_account?: Account;
  to_account?: Account;
}

export interface Budget {
  id: string;
  user_id: string;
  category: string;
  owner_purpose?: string;
  monthly_budget: number;
  is_active: boolean;
  include_in_budget: boolean;
  notes?: string;
  effective_from: string;
  created_at: string;
  updated_at: string;
}

export interface Goal {
  id: string;
  user_id: string;
  name: string;
  goal_type?: string;
  priority: number;
  expected_cost: number;
  planned_purchase_date?: string;
  amount_allocated: number;
  monthly_saving_plan: number;
  payment_plan?: string;
  is_active: boolean;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface UserSettings {
  id: string;
  user_id: string;
  theme: Theme;
  font_choice: FontChoice;
  currency: string;
  currency_symbol: string;
  date_format: string;
  month_start_day: number;
  safe_spend_buffer: number;
  sweep_enabled: boolean;
  dashboard_view: DashboardView;
  selected_month: number;
  selected_year: number;
  created_at: string;
  updated_at: string;
}

export interface AlertLog {
  id: string;
  user_id: string;
  alert_type: string;
  title: string;
  message: string;
  severity: AlertSeverity;
  is_read: boolean;
  related_id?: string;
  related_type?: string;
  created_at: string;
}

// --- Calculated / Derived Types ---

export interface AccountBalance {
  account: Account;
  balance: number;
  is_credit_card: boolean;
  outstanding?: number; // for credit cards
}

export interface BudgetStatus {
  category: string;
  monthly_budget: number;
  daily_budget: number;
  allowed_till_date: number;
  actual_till_date: number;
  remaining_monthly: number;
  overspent: number;
  recovery_per_day: number;
  status: 'green' | 'red' | 'orange' | 'grey';
  days_in_month: number;
  days_elapsed: number;
  days_remaining: number;
  budget_entry?: Budget;
}

export interface DashboardKPIs {
  // Balances
  total_bank_balance: number;
  spendable_balance: number;
  savings_balance: number;
  total_cc_outstanding: number;

  // Period totals
  total_income: number;
  true_income: number;
  total_expense: number;
  personal_expense: number;
  family_expense: number;
  total_savings: number;
  cc_bills_paid: number;

  // Computed
  net_cashflow: number;
  safe_to_spend: number;
  remaining_budget: number;

  // Upcoming
  upcoming_fixed_expenses: number;
  upcoming_cc_dues: number;
}

export interface GoalAnalysis {
  goal: Goal;
  available_saving: number;
  remaining_gap: number;
  can_buy_now: boolean;
  months_needed: number;
  risk_level: 'safe' | 'moderate' | 'risky' | 'not_ready';
  suggested_action: string;
  progress_percent: number;
}

export interface MonthlyTrend {
  month: string; // 'Jan', 'Feb', etc.
  year: number;
  income: number;
  expense: number;
  savings: number;
  net: number;
}

export interface CategorySpend {
  category: string;
  amount: number;
  percent: number;
  color: string;
  count: number;
}

export interface Alert {
  id: string;
  type: string;
  title: string;
  message: string;
  severity: AlertSeverity;
  actionable: boolean;
  action_label?: string;
  action_link?: string;
}

// --- Form Types ---

export interface IncomeFormData {
  date: string;
  amount: number;
  source?: string;
  category: string;
  owner_purpose: string;
  to_account_id: string;
  notes?: string;
  include_in_true_income: boolean;
}

export interface TransactionFormData {
  date: string;
  amount: number;
  description?: string;
  type: TransactionType;
  category?: string;
  owner_purpose?: string;
  from_account_id?: string;
  to_account_id?: string;
  notes?: string;
}

export interface FixedExpenseFormData {
  name: string;
  amount: number;
  type: FixedExpenseType;
  category?: string;
  owner_purpose?: string;
  from_account_id?: string;
  to_account_id?: string;
  due_day: number;
  start_date: string;
  end_date?: string;
  is_active: boolean;
  auto_count: boolean;
  notes?: string;
}

export interface BudgetFormData {
  category: string;
  owner_purpose?: string;
  monthly_budget: number;
  include_in_budget: boolean;
  notes?: string;
}

export interface GoalFormData {
  name: string;
  goal_type?: string;
  priority: number;
  expected_cost: number;
  planned_purchase_date?: string;
  amount_allocated: number;
  monthly_saving_plan: number;
  payment_plan?: string;
  is_active: boolean;
  notes?: string;
}

export interface AccountFormData {
  name: string;
  account_type: string;
  owner_purpose?: string;
  is_active: boolean;
  include_in_dashboard: boolean;
  include_in_goal_savings: boolean;
  is_credit_card: boolean;
  is_spendable: boolean;
  notes?: string;
}

// --- Report Types ---

export interface MonthlyReport {
  period: string; // 'YYYY-MM'
  income: number;
  true_income: number;
  personal_expense: number;
  family_expense: number;
  total_expense: number;
  savings: number;
  cc_bills_paid: number;
  net_cashflow: number;
  closing_balances: AccountBalance[];
  budget_variance: BudgetStatus[];
  top_categories: CategorySpend[];
  opening_balance: number;
}

export interface YearlyReport {
  year: number;
  total_income: number;
  total_expense: number;
  total_savings: number;
  total_cc_bills_paid: number;
  family_expense: number;
  category_annual: CategorySpend[];
  monthly_trends: MonthlyTrend[];
  best_saving_month: string;
  worst_spending_month: string;
}

// --- Filter Types ---

export interface DateFilter {
  view: DashboardView;
  month?: number;
  year?: number;
  start_date?: string;
  end_date?: string;
  status_date?: string;
}

// --- Test Result Types ---

export interface TestResult {
  id: number;
  name: string;
  description: string;
  inputs: Record<string, unknown>;
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
  status: 'PASS' | 'FAIL' | 'RUNNING' | 'PENDING';
  error?: string;
}

// --- Navigation ---

export interface NavItem {
  label: string;
  href: string;
  icon: string;
  badge?: number;
}
