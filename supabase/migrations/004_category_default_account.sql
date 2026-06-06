-- 004: per-category default account for auto-routing
-- When a category has a default account, the transaction form pre-fills the
-- "from" account when you pick that category. Nullable; if an account is
-- deleted, the link clears automatically. Safe to run more than once.
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS default_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL;
