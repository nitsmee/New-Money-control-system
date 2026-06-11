-- 011: per-account limits for soft balance warnings
-- credit_limit  → credit cards: warn when a purchase would push the outstanding
--                  over this limit (NULL / 0 = no limit, no check).
-- overdraft_warn → normal accounts: warn when a debit would take the balance
--                  below zero. Defaults to true (warn). Set false for "virtual"
--                  accounts you intentionally let run negative.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS credit_limit NUMERIC;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS overdraft_warn BOOLEAN NOT NULL DEFAULT true;
