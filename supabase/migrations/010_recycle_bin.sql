-- Migration 010: Recycle bin (soft delete) for transactions.
-- Deleting a transaction sets deleted_at instead of removing the row; it can
-- be restored until explicitly purged. Active queries filter deleted_at IS NULL.

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Fast lookups for both the active list and the recycle bin.
CREATE INDEX IF NOT EXISTS idx_transactions_active
  ON transactions(user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_deleted
  ON transactions(user_id, deleted_at) WHERE deleted_at IS NOT NULL;
