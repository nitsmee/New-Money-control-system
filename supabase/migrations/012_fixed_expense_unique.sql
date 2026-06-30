-- 012: prevent duplicate auto-posted FIXED EXPENSES (one per fixed expense per period).
-- Mirrors migration 007 (which did this for recurring income). Without this, if
-- auto-processing runs concurrently (e.g. two browser tabs / a refresh race), the
-- in-memory de-dup can miss and the same monthly bill posts twice — inflating the
-- account balance / credit-card outstanding.
--
-- NOTE: if this errors with a duplicate-key violation, you already have duplicate
-- auto-posts. Find them first with:
--   SELECT fixed_expense_id, period, COUNT(*)
--   FROM transactions
--   WHERE fixed_expense_id IS NOT NULL AND deleted_at IS NULL
--   GROUP BY 1,2 HAVING COUNT(*) > 1;
-- ...then soft-delete the extras (set deleted_at) before re-running this migration.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fixed_expense_period
  ON transactions (fixed_expense_id, period)
  WHERE fixed_expense_id IS NOT NULL AND deleted_at IS NULL;
