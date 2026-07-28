-- 013: Quick-Add shortcuts + Lend & Borrow (debts) tracker
-- Two independent, additive tables. Nothing else is touched, so no existing
-- data is affected. Both are protected by Row-Level Security keyed to auth.uid().

-- ── Quick-Add shortcuts ────────────────────────────────────────────────
-- A saved transaction template. Tapping it (with an optional quantity) inserts
-- a real transaction of `amount * quantity` with the preset fields.
CREATE TABLE IF NOT EXISTS quick_shortcuts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'expense',   -- expense | transfer | saving
  amount NUMERIC NOT NULL DEFAULT 0,      -- unit amount
  category TEXT,
  owner_purpose TEXT,
  from_account_id UUID,
  to_account_id UUID,
  description TEXT,
  color TEXT,                             -- accent hex for the tile
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE quick_shortcuts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own quick_shortcuts" ON quick_shortcuts;
CREATE POLICY "own quick_shortcuts" ON quick_shortcuts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── Lend & Borrow (debts) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS debts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  direction TEXT NOT NULL DEFAULT 'i_owe',  -- 'i_owe' | 'owed_to_me'
  person TEXT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  currency TEXT,
  description TEXT,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  is_settled BOOLEAN NOT NULL DEFAULT false,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE debts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own debts" ON debts;
CREATE POLICY "own debts" ON debts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
