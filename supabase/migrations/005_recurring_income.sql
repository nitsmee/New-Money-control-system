-- Migration 005: Recurring income templates
-- Mirrors the fixed_expenses pattern for scheduled income entries

CREATE TABLE IF NOT EXISTS recurring_income (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  to_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT 'Salary',
  owner_purpose TEXT,
  due_day INTEGER NOT NULL DEFAULT 1 CHECK (due_day BETWEEN 1 AND 31),
  is_active BOOLEAN NOT NULL DEFAULT true,
  start_date DATE NOT NULL,
  end_date DATE,
  last_processed_period TEXT,
  include_in_true_income BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE recurring_income ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own recurring income"
  ON recurring_income FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_recurring_income_user ON recurring_income(user_id);
CREATE INDEX IF NOT EXISTS idx_recurring_income_active ON recurring_income(user_id, is_active);
