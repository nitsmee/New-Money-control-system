-- ============================================================
-- MONEY CONTROL SYSTEM — Migration 002
-- Computed Views, Helper Functions, Additional Constraints
-- ============================================================

-- ============================================================
-- VIEW: account_balances
-- Pre-computed balance for each account (used by reports)
-- ============================================================
CREATE OR REPLACE VIEW public.account_balances AS
SELECT
  a.id AS account_id,
  a.user_id,
  a.name,
  a.account_type,
  a.is_credit_card,
  a.is_spendable,
  a.include_in_dashboard,
  a.include_in_goal_savings,
  a.is_active,
  -- Income credits
  COALESCE((
    SELECT SUM(i.amount) FROM public.income i
    WHERE i.to_account_id = a.id AND i.user_id = a.user_id
  ), 0)
  -- Initial balance credits
  + COALESCE((
    SELECT SUM(t.amount) FROM public.transactions t
    WHERE t.to_account_id = a.id AND t.type = 'initial_balance' AND t.user_id = a.user_id
  ), 0)
  -- Transfer/saving credits (to_account)
  + COALESCE((
    SELECT SUM(t.amount) FROM public.transactions t
    WHERE t.to_account_id = a.id
      AND t.type IN ('transfer', 'saving', 'adjustment')
      AND t.user_id = a.user_id
  ), 0)
  -- Expense debits (from_account)
  - COALESCE((
    SELECT SUM(t.amount) FROM public.transactions t
    WHERE t.from_account_id = a.id
      AND t.type = 'expense'
      AND t.user_id = a.user_id
  ), 0)
  -- Transfer/saving debits (from_account)
  - COALESCE((
    SELECT SUM(t.amount) FROM public.transactions t
    WHERE t.from_account_id = a.id
      AND t.type IN ('transfer', 'saving', 'credit_card_payment')
      AND t.user_id = a.user_id
  ), 0)
  -- CC outstanding: initial + expenses charged to CC
  + CASE WHEN a.is_credit_card THEN
      COALESCE((
        SELECT SUM(t.amount) FROM public.transactions t
        WHERE t.from_account_id = a.id
          AND t.type = 'initial_cc_outstanding'
          AND t.user_id = a.user_id
      ), 0)
    ELSE 0 END
  AS computed_balance
FROM public.accounts a;

-- Enable RLS on view through underlying tables (views inherit RLS of base tables)

-- ============================================================
-- VIEW: monthly_summary
-- Pre-aggregated monthly income/expense/savings per user
-- ============================================================
CREATE OR REPLACE VIEW public.monthly_summary AS
SELECT
  user_id,
  DATE_TRUNC('month', date::date) AS month,
  TO_CHAR(date::date, 'YYYY-MM') AS period,
  SUM(CASE WHEN include_in_true_income THEN amount ELSE 0 END) AS true_income,
  SUM(amount) AS total_income,
  0::NUMERIC AS total_expense,
  0::NUMERIC AS total_savings
FROM public.income
GROUP BY user_id, DATE_TRUNC('month', date::date), TO_CHAR(date::date, 'YYYY-MM')

UNION ALL

SELECT
  user_id,
  DATE_TRUNC('month', date::date) AS month,
  TO_CHAR(date::date, 'YYYY-MM') AS period,
  0::NUMERIC AS true_income,
  0::NUMERIC AS total_income,
  SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS total_expense,
  SUM(CASE WHEN type = 'saving' THEN amount ELSE 0 END) AS total_savings
FROM public.transactions
GROUP BY user_id, DATE_TRUNC('month', date::date), TO_CHAR(date::date, 'YYYY-MM');

-- ============================================================
-- FUNCTION: get_period_stats
-- Returns income/expense/savings for a given user+period
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_period_stats(
  p_user_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE (
  total_income NUMERIC,
  true_income NUMERIC,
  total_expense NUMERIC,
  personal_expense NUMERIC,
  family_expense NUMERIC,
  total_savings NUMERIC,
  cc_bills_paid NUMERIC,
  net_cashflow NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE((SELECT SUM(amount) FROM public.income WHERE user_id = p_user_id AND date BETWEEN p_start_date AND p_end_date), 0),
    COALESCE((SELECT SUM(amount) FROM public.income WHERE user_id = p_user_id AND date BETWEEN p_start_date AND p_end_date AND include_in_true_income), 0),
    COALESCE((SELECT SUM(amount) FROM public.transactions WHERE user_id = p_user_id AND type = 'expense' AND date BETWEEN p_start_date AND p_end_date), 0),
    COALESCE((SELECT SUM(amount) FROM public.transactions WHERE user_id = p_user_id AND type = 'expense' AND owner_purpose = 'Personal' AND date BETWEEN p_start_date AND p_end_date), 0),
    COALESCE((SELECT SUM(amount) FROM public.transactions WHERE user_id = p_user_id AND type = 'expense' AND owner_purpose IN ('Family / Home', 'Shared') AND date BETWEEN p_start_date AND p_end_date), 0),
    COALESCE((SELECT SUM(amount) FROM public.transactions WHERE user_id = p_user_id AND type = 'saving' AND date BETWEEN p_start_date AND p_end_date), 0),
    COALESCE((SELECT SUM(amount) FROM public.transactions WHERE user_id = p_user_id AND type = 'credit_card_payment' AND date BETWEEN p_start_date AND p_end_date), 0),
    COALESCE((SELECT SUM(amount) FROM public.income WHERE user_id = p_user_id AND date BETWEEN p_start_date AND p_end_date), 0)
    - COALESCE((SELECT SUM(amount) FROM public.transactions WHERE user_id = p_user_id AND type = 'expense' AND date BETWEEN p_start_date AND p_end_date), 0)
    - COALESCE((SELECT SUM(amount) FROM public.transactions WHERE user_id = p_user_id AND type = 'saving' AND date BETWEEN p_start_date AND p_end_date), 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FUNCTION: check_fixed_expense_duplicate
-- Returns true if a fixed expense was already auto-generated
-- for the given period (prevents double-counting)
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_fixed_expense_duplicate(
  p_fixed_expense_id UUID,
  p_period TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.transactions
    WHERE fixed_expense_id = p_fixed_expense_id
      AND period = p_period
      AND is_fixed_expense_auto = TRUE
  ) INTO v_exists;
  RETURN v_exists;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- ADDITIONAL CONSTRAINTS
-- ============================================================

-- Prevent duplicate budget entries for same user+category
-- (already handled by UNIQUE constraint in migration 001)

-- Ensure credit card payment "to" account is actually a credit card
-- (enforced at application layer — too complex for DB constraint alone)

-- Ensure saving "to" account is not a credit card
-- (enforced at application layer)

-- ============================================================
-- PERFORMANCE: Additional indexes
-- NOTE: to_char() is STABLE not IMMUTABLE — cannot be used
-- in an index expression. Use the plain date column instead.
-- idx_income_user_date from migration 001 already covers
-- all period-range queries on the income table.
-- ============================================================

-- transactions.period is a stored TEXT column — safe to index
CREATE INDEX IF NOT EXISTS idx_transactions_user_period_type
  ON public.transactions(user_id, period, type);

CREATE INDEX IF NOT EXISTS idx_goals_user_active
  ON public.goals(user_id, is_active);

CREATE INDEX IF NOT EXISTS idx_fixed_expenses_user_active_due
  ON public.fixed_expenses(user_id, is_active, due_day);