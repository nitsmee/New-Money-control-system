-- ============================================================
-- MONEY CONTROL SYSTEM — Complete Supabase Database Schema
-- Version: 1.0.0
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. MASTER: ACCOUNT TYPES
-- ============================================================
CREATE TABLE public.account_types (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 2. MASTER: ACCOUNTS
-- ============================================================
CREATE TABLE public.accounts (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL,  -- references account_types name
  owner_purpose TEXT,           -- references owners name
  is_active BOOLEAN DEFAULT TRUE,
  include_in_dashboard BOOLEAN DEFAULT TRUE,
  include_in_goal_savings BOOLEAN DEFAULT FALSE,
  is_credit_card BOOLEAN DEFAULT FALSE,
  is_spendable BOOLEAN DEFAULT TRUE,
  notes TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3. MASTER: OWNERS / PURPOSES
-- ============================================================
CREATE TABLE public.owners (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#6366f1',
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 4. MASTER: TRANSACTION CATEGORIES
-- ============================================================
CREATE TABLE public.categories (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- 'income' | 'expense' | 'transfer' | 'saving' | 'all'
  include_in_budget BOOLEAN DEFAULT TRUE,
  color TEXT DEFAULT '#6366f1',
  icon TEXT DEFAULT 'tag',
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 5. INCOME SOURCES
-- ============================================================
CREATE TABLE public.income_sources (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 6. INCOME TRANSACTIONS
-- ============================================================
CREATE TABLE public.income (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
  source TEXT,
  category TEXT NOT NULL,
  owner_purpose TEXT NOT NULL,
  to_account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  notes TEXT,
  include_in_true_income BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 7. TRANSACTIONS (DAILY ENTRY / LEDGER)
-- ============================================================
CREATE TABLE public.transactions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
  description TEXT,
  type TEXT NOT NULL CHECK (type IN (
    'expense', 'transfer', 'credit_card_payment', 'saving',
    'initial_balance', 'initial_cc_outstanding', 'adjustment'
  )),
  category TEXT,
  owner_purpose TEXT,
  from_account_id UUID REFERENCES public.accounts(id) ON DELETE RESTRICT,
  to_account_id UUID REFERENCES public.accounts(id) ON DELETE RESTRICT,
  notes TEXT,
  is_fixed_expense_auto BOOLEAN DEFAULT FALSE,
  fixed_expense_id UUID,  -- references fixed_expenses if auto-generated
  period TEXT,            -- 'YYYY-MM' for duplicate detection
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 8. FIXED EXPENSES
-- ============================================================
CREATE TABLE public.fixed_expenses (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
  type TEXT NOT NULL CHECK (type IN ('expense', 'saving', 'investment', 'transfer')),
  category TEXT,
  owner_purpose TEXT,
  from_account_id UUID REFERENCES public.accounts(id) ON DELETE RESTRICT,
  to_account_id UUID REFERENCES public.accounts(id) ON DELETE RESTRICT,
  due_day INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  start_date DATE NOT NULL,
  end_date DATE,
  is_active BOOLEAN DEFAULT TRUE,
  auto_count BOOLEAN DEFAULT FALSE,
  last_processed_period TEXT, -- 'YYYY-MM' of last auto-generated entry
  notes TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 9. BUDGET
-- ============================================================
CREATE TABLE public.budget (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  owner_purpose TEXT,
  monthly_budget NUMERIC(15, 2) NOT NULL CHECK (monthly_budget >= 0),
  is_active BOOLEAN DEFAULT TRUE,
  include_in_budget BOOLEAN DEFAULT TRUE,
  notes TEXT,
  effective_from DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, category)
);

-- ============================================================
-- 10. GOALS
-- ============================================================
CREATE TABLE public.goals (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  goal_type TEXT,
  priority INTEGER DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  expected_cost NUMERIC(15, 2) NOT NULL CHECK (expected_cost > 0),
  planned_purchase_date DATE,
  amount_allocated NUMERIC(15, 2) DEFAULT 0 CHECK (amount_allocated >= 0),
  monthly_saving_plan NUMERIC(15, 2) DEFAULT 0 CHECK (monthly_saving_plan >= 0),
  payment_plan TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 11. USER SETTINGS / PREFERENCES
-- ============================================================
CREATE TABLE public.user_settings (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  theme TEXT DEFAULT 'light' CHECK (theme IN ('light', 'dark', 'system')),
  font_choice TEXT DEFAULT 'dm-sans' CHECK (font_choice IN ('dm-sans', 'nunito', 'inter', 'outfit', 'poppins')),
  currency TEXT DEFAULT 'INR',
  currency_symbol TEXT DEFAULT '₹',
  date_format TEXT DEFAULT 'DD-MMM-YYYY',
  month_start_day INTEGER DEFAULT 1 CHECK (month_start_day BETWEEN 1 AND 28),
  safe_spend_buffer NUMERIC(15, 2) DEFAULT 5000,
  dashboard_view TEXT DEFAULT 'monthly' CHECK (dashboard_view IN ('monthly', 'yearly', 'custom')),
  selected_month INTEGER DEFAULT EXTRACT(MONTH FROM CURRENT_DATE)::INTEGER,
  selected_year INTEGER DEFAULT EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 12. ALERTS LOG
-- ============================================================
CREATE TABLE public.alerts_log (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  severity TEXT DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'error', 'success')),
  is_read BOOLEAN DEFAULT FALSE,
  related_id UUID,
  related_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================
CREATE INDEX idx_income_user_date ON public.income(user_id, date);
CREATE INDEX idx_income_user_category ON public.income(user_id, category);
CREATE INDEX idx_transactions_user_date ON public.transactions(user_id, date);
CREATE INDEX idx_transactions_user_type ON public.transactions(user_id, type);
CREATE INDEX idx_transactions_user_category ON public.transactions(user_id, category);
CREATE INDEX idx_transactions_from_account ON public.transactions(from_account_id);
CREATE INDEX idx_transactions_to_account ON public.transactions(to_account_id);
CREATE INDEX idx_transactions_period ON public.transactions(user_id, period);
CREATE INDEX idx_budget_user_category ON public.budget(user_id, category);
CREATE INDEX idx_fixed_expenses_user_active ON public.fixed_expenses(user_id, is_active);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE public.account_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.income_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.income ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fixed_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only access their own data
CREATE POLICY "Users own account_types" ON public.account_types FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own accounts" ON public.accounts FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own owners" ON public.owners FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own categories" ON public.categories FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own income_sources" ON public.income_sources FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own income" ON public.income FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own transactions" ON public.transactions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own fixed_expenses" ON public.fixed_expenses FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own budget" ON public.budget FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own goals" ON public.goals FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own user_settings" ON public.user_settings FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own alerts_log" ON public.alerts_log FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- TRIGGERS: auto-update updated_at timestamps
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at_account_types BEFORE UPDATE ON public.account_types FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at_accounts BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at_owners BEFORE UPDATE ON public.owners FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at_categories BEFORE UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at_income BEFORE UPDATE ON public.income FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at_transactions BEFORE UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at_fixed_expenses BEFORE UPDATE ON public.fixed_expenses FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at_budget BEFORE UPDATE ON public.budget FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at_goals BEFORE UPDATE ON public.goals FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at_user_settings BEFORE UPDATE ON public.user_settings FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- FUNCTION: Auto-provision default settings on user signup
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Create default settings
  INSERT INTO public.user_settings (user_id) VALUES (NEW.id);

  -- Create default account types
  INSERT INTO public.account_types (user_id, name, sort_order) VALUES
    (NEW.id, 'Bank Account', 1),
    (NEW.id, 'Cash Wallet', 2),
    (NEW.id, 'Credit Card', 3),
    (NEW.id, 'Savings Bucket', 4),
    (NEW.id, 'Family / Shared Account', 5),
    (NEW.id, 'External Holding', 6),
    (NEW.id, 'Investment / Long-Term Account', 7);

  -- Create default owners/purposes
  INSERT INTO public.owners (user_id, name, color, sort_order) VALUES
    (NEW.id, 'Personal', '#3b82f6', 1),
    (NEW.id, 'Family / Home', '#10b981', 2),
    (NEW.id, 'Shared', '#8b5cf6', 3),
    (NEW.id, 'Business', '#f59e0b', 4),
    (NEW.id, 'Savings', '#06b6d4', 5),
    (NEW.id, 'Bill Payment', '#6366f1', 6),
    (NEW.id, 'Reimbursement', '#ec4899', 7),
    (NEW.id, 'Other', '#6b7280', 8);

  -- Create default expense categories
  INSERT INTO public.categories (user_id, name, type, include_in_budget, color, sort_order) VALUES
    (NEW.id, 'Salary', 'income', FALSE, '#22c55e', 1),
    (NEW.id, 'Variable Pay / Bonus', 'income', FALSE, '#16a34a', 2),
    (NEW.id, 'Family Support', 'income', FALSE, '#10b981', 3),
    (NEW.id, 'Freelance / Side Income', 'income', FALSE, '#059669', 4),
    (NEW.id, 'Interest Income', 'income', FALSE, '#047857', 5),
    (NEW.id, 'Cashback / Refund', 'income', FALSE, '#14532d', 6),
    (NEW.id, 'Gift Received', 'income', FALSE, '#84cc16', 7),
    (NEW.id, 'Grocery', 'expense', TRUE, '#f59e0b', 10),
    (NEW.id, 'Food / Eating Out', 'expense', TRUE, '#ef4444', 11),
    (NEW.id, 'Fuel', 'expense', TRUE, '#f97316', 12),
    (NEW.id, 'Cigarette', 'expense', TRUE, '#6b7280', 13),
    (NEW.id, 'Transport / Auto / Cab', 'expense', TRUE, '#8b5cf6', 14),
    (NEW.id, 'Electricity', 'expense', TRUE, '#eab308', 15),
    (NEW.id, 'Mobile / Recharge', 'expense', TRUE, '#06b6d4', 16),
    (NEW.id, 'Internet', 'expense', TRUE, '#3b82f6', 17),
    (NEW.id, 'Subscription', 'expense', TRUE, '#6366f1', 18),
    (NEW.id, 'EMI', 'expense', TRUE, '#ec4899', 19),
    (NEW.id, 'Medical / Health', 'expense', TRUE, '#f43f5e', 20),
    (NEW.id, 'Shopping', 'expense', TRUE, '#a855f7', 21),
    (NEW.id, 'Home Maintenance', 'expense', TRUE, '#78716c', 22),
    (NEW.id, 'Education', 'expense', TRUE, '#0ea5e9', 23),
    (NEW.id, 'Insurance', 'expense', TRUE, '#64748b', 24),
    (NEW.id, 'Entertainment', 'expense', TRUE, '#e11d48', 25),
    (NEW.id, 'Personal Care', 'expense', TRUE, '#d946ef', 26),
    (NEW.id, 'Miscellaneous', 'expense', TRUE, '#9ca3af', 27),
    (NEW.id, 'Cash Withdrawal', 'transfer', FALSE, '#94a3b8', 30),
    (NEW.id, 'Credit Card Bill', 'transfer', FALSE, '#1e40af', 31),
    (NEW.id, 'Reimbursement / Pass Through', 'transfer', FALSE, '#0891b2', 32),
    (NEW.id, 'Saving', 'saving', FALSE, '#065f46', 33),
    (NEW.id, 'SIP / Investment', 'saving', FALSE, '#064e3b', 34),
    (NEW.id, 'Adjustment', 'all', FALSE, '#374151', 40);

  -- Create default income sources
  INSERT INTO public.income_sources (user_id, name, sort_order) VALUES
    (NEW.id, 'Employer / Salary', 1),
    (NEW.id, 'Client / Freelance', 2),
    (NEW.id, 'Bank / Investment', 3),
    (NEW.id, 'Family', 4),
    (NEW.id, 'Friend', 5),
    (NEW.id, 'Other', 6);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to run after new user signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
