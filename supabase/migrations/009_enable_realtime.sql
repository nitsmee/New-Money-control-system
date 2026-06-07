-- Migration 009: Enable Supabase Realtime for live multi-tab / multi-device sync.
-- Adds each user table to the realtime publication. If a table is already a
-- member you'll get "relation is already member of publication" — that's
-- harmless, just skip that line.

ALTER PUBLICATION supabase_realtime ADD TABLE accounts;
ALTER PUBLICATION supabase_realtime ADD TABLE categories;
ALTER PUBLICATION supabase_realtime ADD TABLE owners;
ALTER PUBLICATION supabase_realtime ADD TABLE income;
ALTER PUBLICATION supabase_realtime ADD TABLE transactions;
ALTER PUBLICATION supabase_realtime ADD TABLE fixed_expenses;
ALTER PUBLICATION supabase_realtime ADD TABLE budget;
ALTER PUBLICATION supabase_realtime ADD TABLE goals;
ALTER PUBLICATION supabase_realtime ADD TABLE recurring_income;
ALTER PUBLICATION supabase_realtime ADD TABLE user_settings;
