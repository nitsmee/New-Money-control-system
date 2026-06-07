-- Migration 007: Prevent duplicate auto-processed recurring income.
-- Defense-in-depth against a race where two concurrent auto-process runs
-- both insert the same (recurring_income_id, period) row.
--
-- NOTE: if you already have duplicate rows from testing, de-duplicate first:
--   DELETE FROM income a USING income b
--   WHERE a.ctid < b.ctid
--     AND a.recurring_income_id = b.recurring_income_id
--     AND a.period = b.period
--     AND a.recurring_income_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_income_recurring_period
  ON income(user_id, recurring_income_id, period)
  WHERE recurring_income_id IS NOT NULL;
