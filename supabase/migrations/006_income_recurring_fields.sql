-- Migration 006: Add period and recurring_income_id to income table
-- Required for recurring income auto-processing (autoProcessIncome.ts)

ALTER TABLE income
  ADD COLUMN IF NOT EXISTS period TEXT,
  ADD COLUMN IF NOT EXISTS recurring_income_id UUID REFERENCES recurring_income(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS description TEXT;

-- Index for fast idempotency check in runAutoProcessIncome
CREATE INDEX IF NOT EXISTS idx_income_recurring ON income(user_id, recurring_income_id, period)
  WHERE recurring_income_id IS NOT NULL;

-- Back-fill period for existing income rows that don't have it
UPDATE income SET period = to_char(date::date, 'YYYY-MM') WHERE period IS NULL;
