-- Migration 008: Multi-currency support
-- Each account has its own currency; the user's settings.currency is the
-- "base" currency. exchange_rates stores value-of-1-unit-in-base for each
-- currency (base itself is implicitly 1).

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS currency TEXT;

-- Backfill existing accounts to the user's base currency (default INR).
UPDATE accounts a
SET currency = COALESCE(
  (SELECT us.currency FROM user_settings us WHERE us.user_id = a.user_id),
  'INR'
)
WHERE currency IS NULL;

-- Store manual/auto exchange rates as a JSON map, e.g. {"THB": 2.38, "USD": 83.1}
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS exchange_rates JSONB DEFAULT '{}'::jsonb;
