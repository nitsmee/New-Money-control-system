-- ============================================================
-- MONEY CONTROL SYSTEM — Demo Seed Data
-- Run AFTER creating your first account via the app UI.
-- Replace 'YOUR-USER-UUID-HERE' with your actual user ID from
-- Supabase Auth → Users panel.
-- ============================================================

-- HOW TO USE:
-- 1. Register in the app
-- 2. Go to Supabase → Table Editor → auth.users, copy your user ID
-- 3. Replace all occurrences of 'YOUR-USER-UUID-HERE' below
-- 4. Run this SQL in Supabase → SQL Editor

DO $$
DECLARE
  v_uid UUID := 'YOUR-USER-UUID-HERE';  -- ← REPLACE THIS

  -- Account IDs
  v_main_bank UUID;
  v_family_acc UUID;
  v_cash UUID;
  v_cc1 UUID;
  v_cc2 UUID;
  v_liquid_savings UUID;
  v_emergency UUID;

BEGIN

-- ============================================================
-- ACCOUNTS
-- ============================================================
INSERT INTO public.accounts (user_id, name, account_type, is_active, include_in_dashboard, include_in_goal_savings, is_credit_card, is_spendable, sort_order)
VALUES
  (v_uid, 'Main Bank Account',    'Bank Account',                TRUE, TRUE,  FALSE, FALSE, TRUE,  1),
  (v_uid, 'Family Virtual Account','Family / Shared Account',   TRUE, TRUE,  FALSE, FALSE, TRUE,  2),
  (v_uid, 'Cash Wallet',          'Cash Wallet',                 TRUE, TRUE,  FALSE, FALSE, TRUE,  3),
  (v_uid, 'Credit Card 1',        'Credit Card',                 TRUE, TRUE,  FALSE, TRUE,  FALSE, 4),
  (v_uid, 'Credit Card 2',        'Credit Card',                 TRUE, TRUE,  FALSE, TRUE,  FALSE, 5),
  (v_uid, 'Liquid Savings',       'Savings Bucket',              TRUE, TRUE,  TRUE,  FALSE, FALSE, 6),
  (v_uid, 'Emergency Fund',       'Savings Bucket',              TRUE, TRUE,  TRUE,  FALSE, FALSE, 7)
RETURNING id INTO v_main_bank;

SELECT id INTO v_main_bank      FROM public.accounts WHERE user_id = v_uid AND name = 'Main Bank Account';
SELECT id INTO v_family_acc     FROM public.accounts WHERE user_id = v_uid AND name = 'Family Virtual Account';
SELECT id INTO v_cash           FROM public.accounts WHERE user_id = v_uid AND name = 'Cash Wallet';
SELECT id INTO v_cc1            FROM public.accounts WHERE user_id = v_uid AND name = 'Credit Card 1';
SELECT id INTO v_cc2            FROM public.accounts WHERE user_id = v_uid AND name = 'Credit Card 2';
SELECT id INTO v_liquid_savings FROM public.accounts WHERE user_id = v_uid AND name = 'Liquid Savings';
SELECT id INTO v_emergency      FROM public.accounts WHERE user_id = v_uid AND name = 'Emergency Fund';

-- ============================================================
-- INITIAL BALANCES (transactions)
-- ============================================================
INSERT INTO public.transactions (user_id, date, amount, type, description, to_account_id, period)
VALUES
  (v_uid, '2026-01-01', 6233,    'initial_balance', 'Opening balance', v_main_bank,      '2026-01'),
  (v_uid, '2026-01-01', 500,     'initial_balance', 'Opening cash',    v_cash,            '2026-01'),
  (v_uid, '2026-01-01', 150000,  'initial_balance', 'Existing savings',v_liquid_savings,  '2026-01'),
  (v_uid, '2026-01-01', 50000,   'initial_balance', 'Emergency fund',  v_emergency,       '2026-01');

-- CC initial outstanding
INSERT INTO public.transactions (user_id, date, amount, type, description, from_account_id, period)
VALUES
  (v_uid, '2026-01-01', 6967,  'initial_cc_outstanding', 'Opening CC balance', v_cc1, '2026-01'),
  (v_uid, '2026-01-01', 24315, 'initial_cc_outstanding', 'EMI outstanding',    v_cc2, '2026-01');

-- ============================================================
-- INCOME — May 2026
-- ============================================================
INSERT INTO public.income (user_id, date, amount, source, category, owner_purpose, to_account_id, include_in_true_income, notes)
VALUES
  (v_uid, '2026-05-29', 87584,  'Employer', 'Salary',             'Personal',      v_main_bank,  TRUE,  'Regular monthly salary'),
  (v_uid, '2026-05-29', 26981,  'Employer', 'Variable Pay / Bonus','Personal',     v_main_bank,  TRUE,  'Variable component'),
  (v_uid, '2026-05-01', 80000,  'Family',   'Family Support',      'Family / Home', v_family_acc, FALSE, 'Monthly home budget from family');

-- ============================================================
-- TRANSACTIONS — May 2026
-- ============================================================
-- Expenses
INSERT INTO public.transactions (user_id, date, amount, type, category, owner_purpose, from_account_id, description, period)
VALUES
  (v_uid, '2026-05-01', 15,    'expense', 'Cigarette',     'Personal',      v_cash,       'Cigarette pack', '2026-05'),
  (v_uid, '2026-05-02', 500,   'expense', 'Fuel',          'Personal',      v_main_bank,  'Petrol fill',    '2026-05'),
  (v_uid, '2026-05-03', 269,   'expense', 'Grocery',       'Family / Home', v_family_acc, 'Vegetables',     '2026-05'),
  (v_uid, '2026-05-05', 450,   'expense', 'Food / Eating Out','Personal',   v_cc1,        'Swiggy order',   '2026-05'),
  (v_uid, '2026-05-07', 1200,  'expense', 'Grocery',       'Family / Home', v_family_acc, 'Big Bazaar',     '2026-05'),
  (v_uid, '2026-05-10', 1200,  'expense', 'Cigarette',     'Personal',      v_cash,       'Monthly stock',  '2026-05'),
  (v_uid, '2026-05-12', 800,   'expense', 'Transport / Auto / Cab','Personal',v_main_bank,'Cab rides',     '2026-05'),
  (v_uid, '2026-05-15', 3500,  'expense', 'Shopping',      'Personal',      v_cc1,        'Clothing',       '2026-05'),
  (v_uid, '2026-05-18', 250,   'expense', 'Medical / Health','Personal',    v_main_bank,  'Medicine',       '2026-05'),
  (v_uid, '2026-05-20', 600,   'expense', 'Entertainment', 'Personal',      v_cc1,        'Movie tickets',  '2026-05'),
  (v_uid, '2026-05-22', 1500,  'expense', 'Home Maintenance','Family / Home',v_family_acc,'Plumber',        '2026-05'),
  (v_uid, '2026-05-25', 400,   'expense', 'Personal Care', 'Personal',      v_cash,       'Salon',          '2026-05');

-- CC Bill Payment
INSERT INTO public.transactions (user_id, date, amount, type, category, owner_purpose, from_account_id, to_account_id, description, period)
VALUES
  (v_uid, '2026-05-10', 6967, 'credit_card_payment', 'Credit Card Bill', 'Bill Payment', v_main_bank, v_cc1, 'CC1 May payment', '2026-05');

-- Cash Withdrawal (Transfer)
INSERT INTO public.transactions (user_id, date, amount, type, category, from_account_id, to_account_id, description, period)
VALUES
  (v_uid, '2026-05-01', 5000, 'transfer', 'Cash Withdrawal', v_main_bank, v_cash, 'ATM withdrawal', '2026-05');

-- Saving Transfer
INSERT INTO public.transactions (user_id, date, amount, type, category, owner_purpose, from_account_id, to_account_id, description, period)
VALUES
  (v_uid, '2026-05-29', 26981, 'saving', 'Saving', 'Savings', v_main_bank, v_liquid_savings, 'Variable pay → savings', '2026-05');

-- ============================================================
-- FIXED EXPENSES
-- ============================================================
INSERT INTO public.fixed_expenses (user_id, name, amount, type, category, owner_purpose, from_account_id, to_account_id, due_day, start_date, end_date, is_active, auto_count)
VALUES
  (v_uid, 'Netflix',       2034,      'expense',    'Subscription',    'Personal',      v_cc1,       NULL,            30, '2025-01-01', NULL,         TRUE, FALSE),
  (v_uid, 'Credit Card EMI',24314.85, 'expense',    'EMI',             'Personal',      v_cc2,       NULL,            20, '2026-01-20', '2026-06-20', TRUE, FALSE),
  (v_uid, 'SIP Investment', 10000,    'investment', 'SIP / Investment', 'Savings',      v_main_bank, v_liquid_savings, 5, '2025-06-01', NULL,         TRUE, FALSE),
  (v_uid, 'Internet Bill',  999,      'expense',    'Internet',        'Family / Home', v_main_bank, NULL,             1, '2024-01-01', NULL,         TRUE, FALSE),
  (v_uid, 'Mobile Recharge',299,      'expense',    'Mobile / Recharge','Personal',    v_main_bank, NULL,             1, '2024-01-01', NULL,         TRUE, FALSE);

-- ============================================================
-- BUDGETS
-- ============================================================
INSERT INTO public.budget (user_id, category, monthly_budget, include_in_budget)
VALUES
  (v_uid, 'Cigarette',           3000,  TRUE),
  (v_uid, 'Grocery',            10000,  TRUE),
  (v_uid, 'Food / Eating Out',   5000,  TRUE),
  (v_uid, 'Fuel',                2000,  TRUE),
  (v_uid, 'Transport / Auto / Cab',1500,TRUE),
  (v_uid, 'Entertainment',       2000,  TRUE),
  (v_uid, 'Shopping',            5000,  TRUE),
  (v_uid, 'Medical / Health',    2000,  TRUE),
  (v_uid, 'Personal Care',       1500,  TRUE),
  (v_uid, 'Home Maintenance',    3000,  TRUE),
  (v_uid, 'Subscription',        3000,  TRUE),
  (v_uid, 'Miscellaneous',       2000,  TRUE)
ON CONFLICT (user_id, category) DO NOTHING;

-- ============================================================
-- GOALS
-- ============================================================
INSERT INTO public.goals (user_id, name, goal_type, priority, expected_cost, monthly_saving_plan, is_active, notes)
VALUES
  (v_uid, 'New Car',        'Car',      2, 1400000, 20000, TRUE, 'Planning to buy hatchback'),
  (v_uid, 'New TV',         'TV',       3, 60000,   5000,  TRUE, '55 inch 4K LED'),
  (v_uid, 'iPhone 16',      'Mobile / Smartphone',3,89000,10000,TRUE,'Latest model'),
  (v_uid, 'Europe Trip',    'Travel / Vacation',4,200000, 15000, TRUE,'Family vacation 2027');

END $$;
