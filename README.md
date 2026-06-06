# Money Control System

A production-ready personal finance web application built with **Next.js 14, TypeScript, Tailwind CSS, and Supabase**. Track income, expenses, budgets, credit cards, savings goals, and recurring payments — all with proper double-entry accounting logic, real-time sync across devices, and optional PWA installation.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Feature List](#2-feature-list)
3. [Tech Stack](#3-tech-stack)
4. [Prerequisites](#4-prerequisites)
5. [Installation](#5-installation)
6. [Environment Variables](#6-environment-variables)
7. [Database Setup](#7-database-setup)
8. [Running Locally](#8-running-locally)
9. [First-Time App Setup](#9-first-time-app-setup)
10. [Project Structure](#10-project-structure)
11. [Key Concepts & Accounting Logic](#11-key-concepts--accounting-logic)
12. [Transaction Types](#12-transaction-types)
13. [Fixed Expenses Auto-Processing](#13-fixed-expenses-auto-processing)
14. [Budget Calculation Logic](#14-budget-calculation-logic)
15. [Goals Logic](#15-goals-logic)
16. [Alerts Logic](#16-alerts-logic)
17. [Test Cases (All 30)](#17-test-cases-all-30)
18. [Deployment Guide](#18-deployment-guide)
19. [PWA Installation](#19-pwa-installation)
20. [Configuration & Settings](#20-configuration--settings)
21. [Development Commands](#21-development-commands)
22. [Troubleshooting](#22-troubleshooting)
23. [Contributing](#23-contributing)

---

## 1. Project Overview

Money Control System is a self-hosted personal finance tracker designed for Indian households (defaults to INR) but configurable for any currency. It solves a specific problem: most budgeting apps either over-simplify (ignoring credit cards, family money, reimbursements) or are too complex. This app applies correct accounting rules so every rupee is counted exactly once.

Key design principles:

- **No double counting.** Credit card spends do not reduce your bank balance until you pay the bill. CC bill payments do not count as expenses. Saving transfers are not expenses.
- **True Income vs Total Income.** Family money, pass-through reimbursements, and cashback can be flagged to exclude them from your "real" income figure.
- **Account roles.** Each account is classified as `cash`, `savings`, `investment`, `family`, or `credit_card`. Totals are computed per role, so no amount appears in two buckets simultaneously.
- **Safe-to-Spend.** A single headline number that tells you what you can actually spend: spendable balance minus upcoming bank-paid bills minus CC outstanding minus your configured safety buffer.

---

## 2. Feature List

| Module | Details |
|---|---|
| **Dashboard** | 9 KPI cards (plus a dynamic sweep card) with click-to-explain breakdowns, salary usage progress bar, last-12-months area chart (income/expense/savings), per-category pie chart, account balance list, budget status bars, last 10 transactions, inline alerts. Auto-posts due fixed expenses on page load. KPI cards include: Safe to Spend, Spendable, Savings, Investments, CC Outstanding, Net Cashflow, Income this month, Upcoming Fixed, and a Payday Sweep card (shows "Swept to savings" once a sweep is recorded, or "Ready to sweep" beforehand). Net worth line (cash + savings + investments − card debt) is shown below the card grid. Family/shared money is tracked and displayed separately when present. |
| **Accounts** | Dedicated page showing all accounts with live balances. Create/edit/delete accounts. |
| **Income** | Record salary, bonus, family money, freelance, interest, cashback. `include_in_true_income` flag separates real earnings from pass-through money. Full CRUD with month/year filters. Monthly totals for Total Income and True Income are shown in the filter bar. When a new salary entry is saved for the current month and the **Payday Sweep** preference is enabled, the form detects any leftover balance in the destination account from before and offers to move it into the savings bucket automatically. |
| **Transactions** | All 7 transaction types (expense, transfer, CC payment, saving, initial balance, initial CC outstanding, adjustment). Full table with month/year date filter and transaction-type filter. Period totals (Expense, Savings, CC Paid) are shown in the filter bar. When adding a transaction, selecting a category with a **default account** set auto-fills the "From Account" field. The year selector extends automatically each year so the app never caps out. Edit/delete with confirmation. |
| **Fixed Expenses** | Define recurring payments (EMIs, subscriptions, SIPs). Set due day, start date, optional end date. `auto_count` flag triggers automatic transaction creation on the dashboard load. Tracks `last_processed_period` to prevent duplicates. |
| **Budget** | Per-category monthly limits. Status: green (on track), orange (within 10% of daily pace), red (discretionary spending ahead of pace or over monthly limit). Daily budget pacing treats fixed bills as lump sums. |
| **Goals** | Define goals (car, travel, appliance, etc.) with expected cost, monthly saving plan, and priority (1–5). `analyzeGoal` computes gap, months needed, risk level, and whether you can buy now. |
| **Reports** | Monthly, yearly, and custom date-range summaries. Top categories, budget variance, trend charts. CSV export via PapaParse. |
| **Alerts** | Real-time alerts for: budget exceeded, spending ahead of daily pace, negative account balances, high CC outstanding (> ₹10,000), and fixed expenses due within 5 days. |
| **Settings** | Four tabs: Accounts, Categories, Owners/Purposes, Preferences. JSON backup export. Accounts with transaction history are deactivated (not deleted) to preserve report accuracy. The **Categories tab** now includes a "Routes to" column and a **Default Account** dropdown per category — when set, the transaction form pre-fills the "From Account" automatically. The **Preferences tab** includes an **Auto-sweep leftover into savings on payday** toggle that controls the income-page sweep behaviour. |
| **Test Results** | Built-in test suite — 30 specification tests run in the browser against live data. Shows PASS / FAIL / SKIPPED with reason and actual vs expected values. |

---

## 3. Tech Stack

| Layer | Library | Version |
|---|---|---|
| Framework | Next.js (App Router) | 14.2.5 |
| Language | TypeScript | ^5.5.3 |
| Styling | Tailwind CSS | ^3.4.6 |
| State Management | Zustand (with `persist`) | ^4.5.4 |
| Backend / Database | Supabase (PostgreSQL) | @supabase/supabase-js ^2.45.0 |
| Auth | Supabase Auth | via @supabase/ssr ^0.5.1 |
| Charts | Recharts | ^2.12.7 |
| Icons | Lucide React | ^0.407.0 |
| Forms | React Hook Form + Zod | ^7.52.1 / ^3.23.8 |
| Date Utilities | date-fns | ^3.6.0 |
| CSV Export/Import | PapaParse | ^5.4.1 |
| Animations | Framer Motion | ^11.3.8 |
| UI Primitives | Radix UI (Alert Dialog, Dialog, Dropdown, Popover, Select, Switch, Tabs, Tooltip) | ^1.x |
| Toasts | react-hot-toast | ^2.4.1 |
| PWA | next-pwa | ^5.6.0 |
| Runtime | Node.js | 18.17+ |

---

## 4. Prerequisites

| Tool | Minimum Version | Check |
|---|---|---|
| Node.js | 18.17 | `node --version` |
| npm | 9 | `npm --version` |
| Git | any | `git --version` |

You also need a free **Supabase** account at [supabase.com](https://supabase.com).

---

## 5. Installation

### Step 1 — Get the code

```bash
git clone https://github.com/YOUR_USERNAME/money-control-system.git
cd money-control-system
```

Or download and extract a ZIP, then `cd` into the folder.

### Step 2 — Create Supabase project

1. Log in at [supabase.com](https://supabase.com) and click **New Project**.
2. Enter a name, strong database password, and pick the region nearest you.
3. Wait ~2 minutes for provisioning.
4. Go to **Settings → API** and copy:
   - **Project URL** (`https://xxxx.supabase.co`)
   - **anon public key** (the long `eyJ...` string)

### Step 3 — Configure Supabase Auth

1. **Authentication → Providers** — confirm Email is enabled.
2. **Authentication → URL Configuration**:
   - Site URL: `http://localhost:3000`
   - Redirect URLs: add `http://localhost:3000/auth/callback`
3. For production, repeat with your deployed URL.

### Step 4 — Install dependencies

```bash
npm install
```

### Step 5 — Configure environment

```bash
# macOS / Linux
cp .env.local.example .env.local

# Windows
copy .env.local.example .env.local
```

Edit `.env.local` and fill in:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
```

---

## 6. Environment Variables

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL from Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon/public key from Settings → API |
| `NEXT_PUBLIC_APP_NAME` | No | Display name (default: `"Money Control System"`) |
| `NEXT_PUBLIC_APP_URL` | No | App base URL (default: `http://localhost:3000`) |

Only `NEXT_PUBLIC_` prefixed variables are sent to the browser. The `anon` key is safe to expose — all data access is governed by Row Level Security policies in PostgreSQL. Never use the `service_role` key in the frontend.

---

## 7. Database Setup

Three migration files must be run in order in Supabase SQL Editor (**SQL Editor → New query → paste → Run**):

### Migration 001 — `supabase/migrations/001_initial_schema.sql`

Creates all 12 tables:

| Table | Purpose |
|---|---|
| `account_types` | Configurable account type names per user |
| `accounts` | Bank accounts, wallets, credit cards, savings, investment accounts |
| `owners` | Owner / purpose labels (Personal, Family, Business, etc.) |
| `categories` | Income and expense categories with color, type, and optional `default_account_id` for auto-routing |
| `income_sources` | Source labels for income entries |
| `income` | All income transactions (credits to an account) |
| `transactions` | All ledger entries (expenses, transfers, CC payments, savings, adjustments, initial balances) |
| `fixed_expenses` | Recurring payment templates |
| `budget` | Monthly category budget limits |
| `goals` | Savings goals with gap analysis parameters |
| `user_settings` | Per-user preferences (theme, font, currency, buffer, etc.) |
| `alerts_log` | System-generated alert history |

Also creates:
- **10 performance indexes** on frequently filtered columns
- **Row Level Security (RLS)** on every table — each policy uses `auth.uid() = user_id`, so no user can ever read or write another user's data
- `handle_updated_at()` trigger function + triggers on all mutable tables
- `handle_new_user()` trigger that auto-provisions default data on signup: 7 account types, 8 owners, 31 categories (7 income + 18 expense + 3 transfer + 2 saving + 1 adjustment), 6 income sources

### Migration 002 — `supabase/migrations/002_views_and_functions.sql`

Creates:

| Object | Type | Purpose |
|---|---|---|
| `account_balances` | VIEW | Pre-computed balance per account from all ledger entries |
| `monthly_summary` | VIEW | Pre-aggregated monthly income/expense/savings |
| `get_period_stats(user_id, start, end)` | FUNCTION | Returns period income, true_income, expenses (personal/family split), savings, CC bills, net cashflow |
| `check_fixed_expense_duplicate(id, period)` | FUNCTION | Returns boolean — prevents double-posting a fixed expense for a given period |

Additional indexes: `idx_transactions_user_period_type`, `idx_goals_user_active`, `idx_fixed_expenses_user_active_due`.

### Migration 003 (if present) — check `supabase/migrations/` for any intermediate migration

Run any migration files between 002 and 004 before proceeding.

### Migration 004 — `supabase/migrations/004_category_default_account.sql`

Adds per-category default account routing:

```sql
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS default_account_id UUID
  REFERENCES public.accounts(id) ON DELETE SET NULL;
```

| What it does | Detail |
|---|---|
| New column | `default_account_id` (nullable UUID) on the `categories` table |
| Foreign key | References `public.accounts(id)`. If the linked account is deleted, the column is set to `NULL` automatically (`ON DELETE SET NULL`). |
| Purpose | When a category has a default account set, the transaction form pre-fills the "From Account" field whenever that category is selected. |
| Safe to re-run | Uses `ADD COLUMN IF NOT EXISTS`, so running it more than once causes no harm. |

### Demo Data (optional)

To populate the app with realistic sample data:

1. Register in the app and log in.
2. Go to Supabase → **Authentication → Users** and copy your User ID.
3. Open `supabase/seed_demo.sql`, replace `YOUR-USER-UUID-HERE` with your User ID.
4. Run the file in Supabase SQL Editor.

---

## 8. Running Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You will see the login page. Click **"Create one free"** to register.

On first login:
- The `handle_new_user` trigger auto-creates your default accounts types, owners, categories, income sources, and user settings.
- The dashboard immediately loads and auto-processes any due fixed expenses.

---

## 9. First-Time App Setup

After registering, complete this setup flow:

1. **Settings → Accounts** — Rename default accounts to match your real bank/card names. Add credit cards (mark `Is Credit Card = true`). Mark savings accounts with `Include in Goal Savings`.
2. **Transactions → Add Transaction** — Add an `Initial Balance` for each bank/cash account (sets opening balance). Add `Initial CC Outstanding` for any existing credit card debt.
3. **Budget → Add Budget** — Set monthly limits per spending category.
4. **Income → Add Income** — Add your salary for the current month.
5. **Test Results → Run All 30 Tests** — Verify the system is working correctly against your data.

---

## 10. Project Structure

```
money-control-system/
├── src/
│   ├── app/
│   │   ├── auth/
│   │   │   ├── login/page.tsx           Login form with Supabase email auth
│   │   │   ├── register/page.tsx        Registration form
│   │   │   └── callback/route.ts        Handles OAuth callback redirect
│   │   ├── dashboard/
│   │   │   ├── layout.tsx               Collapsible sidebar (desktop) + mobile slide-over + bottom nav
│   │   │   ├── page.tsx                 Main dashboard: KPI cards, charts, alerts, recent transactions
│   │   │   ├── accounts/page.tsx        Account list with live computed balances
│   │   │   ├── income/page.tsx          Income CRUD: add/edit/delete income entries
│   │   │   ├── transactions/page.tsx    Transaction CRUD: all 7 types, search, filters
│   │   │   ├── fixed-expenses/page.tsx  Recurring payments CRUD + manual trigger
│   │   │   ├── budget/page.tsx          Budget CRUD + status cards with daily pacing
│   │   │   ├── goals/page.tsx           Goals CRUD + gap analysis cards
│   │   │   ├── reports/page.tsx         Monthly/yearly/custom reports + CSV export
│   │   │   ├── alerts/page.tsx          Full alerts list from generateAlerts()
│   │   │   ├── settings/page.tsx        Accounts / Categories / Owners / Preferences tabs
│   │   │   └── test-results/page.tsx    30 spec tests run in browser against live data
│   │   ├── api/health/route.ts          Health-check endpoint — returns 200 OK
│   │   ├── globals.css                  Design system: CSS custom properties, Tailwind component classes
│   │   ├── layout.tsx                   Root layout: font loading, toast provider, metadata
│   │   └── page.tsx                     Root redirect → /dashboard (middleware handles auth)
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts                Browser-side Supabase client (createBrowserClient)
│   │   │   └── server.ts                Server-side Supabase client (createServerClient, cookie-based)
│   │   ├── store/
│   │   │   └── appStore.ts              Zustand store: all application state + CRUD helpers
│   │   └── utils/
│   │       ├── calculations.ts          All financial logic (see section 11)
│   │       └── autoProcess.ts           Fixed expense auto-posting engine
│   ├── types/index.ts                   All TypeScript interfaces, enums, and form types
│   └── middleware.ts                    Route protection: redirects unauthenticated → /auth/login
├── supabase/
│   ├── migrations/
│   │   ├── 001_initial_schema.sql           Tables, RLS, triggers, handle_new_user auto-provisioning
│   │   ├── 002_views_and_functions.sql      Views, DB functions, additional indexes
│   │   └── 004_category_default_account.sql Adds default_account_id to categories
│   └── seed_demo.sql                    Optional realistic demo data
├── public/
│   ├── manifest.json                    PWA manifest (shortcuts: Add Transaction, View Dashboard)
│   ├── favicon.svg
│   └── icons/icon.svg                   Source icon for PWA icon generation
├── scripts/
│   └── generate-icons.js               Generates PNG icons in 8 sizes for PWA manifest
├── .env.local.example                   Environment variable template
├── next.config.js                       React strict mode, SWC minify, security headers, image domains
├── tailwind.config.js                   Tailwind configuration
├── tsconfig.json                        TypeScript config
└── package.json                         Dependencies and scripts
```

---

## 11. Key Concepts & Accounting Logic

All financial logic lives in `src/lib/utils/calculations.ts`. Understanding these concepts is essential to extending the app.

### Account Roles

Every account is classified into one of five mutually exclusive roles by `accountRole(account)`:

| Role | Detection | Effect on totals |
|---|---|---|
| `cash` | Default; bank/wallet accounts | Contributes to `spendable_balance` |
| `savings` | Account type contains "saving" OR `include_in_goal_savings = true` | Contributes to `savings_balance` |
| `investment` | Account type matches `/invest|long.?term|mutual|stock|equit|brokerage|demat|sip/` | Contributes to `investTotal` (net worth only) |
| `family` | Account type matches `/family|shared|joint/` OR owner matches `/family|shared/` | Tracked separately as `familyTotal` |
| `credit_card` | `is_credit_card = true` | Tracked as outstanding, subtracted from net worth |

`total_bank_balance = spendable_balance + savings_balance`. Investments and family money are excluded to prevent double-counting.

### Sign Convention in `calculateAccountBalances`

The internal `raw` value per account:

- **Normal accounts**: positive = money you have
- **Credit cards**: positive = outstanding you owe

Per-type accounting rules:

| Transaction type | From account effect | To account effect |
|---|---|---|
| `expense` | Bank: `raw -= amount`. CC: `raw += amount` (outstanding up). | — |
| `transfer` | Bank: `raw -= amount`. CC: `raw += amount`. | Bank: `raw += amount`. CC: `raw -= amount`. |
| `credit_card_payment` | Bank: `raw -= amount`. | CC: `raw -= amount` (outstanding down). |
| `saving` | Bank: `raw -= amount`. CC: `raw += amount`. | Bank/savings: `raw += amount`. |
| `initial_balance` | — | `raw += amount` (sets opening balance). |
| `initial_cc_outstanding` | `raw += amount` (sets opening outstanding). | — |
| `adjustment` | `raw -= amount` if `from_account` used. | `raw += amount` if `to_account` used. |

The returned `AccountBalance` converts this: `balance = raw` for normal accounts, `balance = -raw` and `outstanding = max(0, raw)` for credit cards. This corrects a previous bug where credit card balances were shown as `-₹0` because CC expenses were subtracted (pushing `raw` negative) instead of added.

### True Income vs Total Income

Every income entry has `include_in_true_income: boolean`. When `false`, the entry (e.g., family money received, a friend repaying you) is counted in `total_income` but excluded from `true_income`. This lets the dashboard show your genuine earnings separately from pass-through money.

### Safe-to-Spend Formula

```
safe_to_spend = spendable_balance
              - bank_paid_upcoming_fixed_expenses
              - total_cc_outstanding
              - safe_spend_buffer
```

Key detail: fixed expenses paid by credit card are **excluded** from `bank_paid_upcoming` because they are already captured in `total_cc_outstanding`. Including them in both would double-count them. The result can be negative (shown as-is) so the dashboard always reflects reality rather than clamping to zero.

### Family vs Personal Expense Classification

`family_expense` and `personal_expense` are derived from the **account role** of the transaction's `from_account`, with a fallback to the `owner_purpose` field:

- An expense from an account whose role is `family` (type matches `/family|shared|joint/` or owner matches `/family|shared/`) counts as a family expense.
- An expense whose `owner_purpose` matches `/family|shared|home|joint/i` also counts as family.
- Every expense falls into exactly one bucket, so `family_expense + personal_expense = total_expense` with no overlap and no double-counting. (Previously the split depended on hardcoded owner strings.)

### Net Cashflow

```
net_cashflow = total_income - total_expense - total_savings
```

Saving transfers are treated as moving money out of the operating cash flow (they reduce net cashflow) but do not count as expenses. On the dashboard the `total_savings` figure is further split into **saved** (destination is a savings account) and **invested** (destination is an investment account), with the invested portion shown as a separate line in the Net Cashflow breakdown.

---

## 12. Transaction Types

There are 7 transaction types stored in the `transactions` table. Each has specific accounting behavior:

| Type | `from_account` | `to_account` | Accounting effect |
|---|---|---|---|
| `expense` | Account money leaves | — | Bank: balance decreases. CC: outstanding increases. Counted as expense in reports. |
| `transfer` | Source account | Destination account | Money moves between accounts. Not an expense. Not income. |
| `credit_card_payment` | Bank account (payment source) | Credit card | Bank balance decreases AND CC outstanding decreases. Not an expense. |
| `saving` | Source account | Savings account | Source decreases, savings increases. Not an expense. Appears as savings in cashflow. |
| `initial_balance` | — | Bank/cash account | Sets the opening balance of an account. Not income. |
| `initial_cc_outstanding` | Credit card | — | Sets opening CC outstanding. Not an expense. |
| `adjustment` | or `to_account` | or `from_account` | Manual correction. Uses `to_account` for positive adjustments, `from_account` for negative. |

**Income is a separate table** (`income`), not in `transactions`. All income entries credit `to_account_id`.

---

## 13. Fixed Expenses Auto-Processing

Fixed expenses are templates for recurring payments (e.g., rent on the 1st, Netflix on the 5th, a car EMI from the 10th to month 36).

### Configuration fields

| Field | Type | Description |
|---|---|---|
| `due_day` | 1–31 | Day of month the charge occurs (clamped to month length) |
| `start_date` | DATE | First month this payment applies |
| `end_date` | DATE (optional) | Last month — use for EMIs with a fixed end |
| `is_active` | boolean | Whether this payment is currently tracked |
| `auto_count` | boolean | If true, auto-posting engine creates transactions automatically |
| `type` | expense / saving / investment / transfer | Determines the transaction type created |

### Upcoming fixed expenses calculation

`upcoming_fixed_expenses` in the dashboard KPIs shows only the fixed expenses that are **due in the selected month and not yet posted**. The logic:

1. Computes the due date for the selected month using `safeDueDate()` (clamps day to real month length).
2. Excludes expenses whose due date falls outside their `start_date`–`end_date` window.
3. Excludes expenses already posted this month by checking `(fixed_expense_id, period)` pairs in the transactions table.
4. CC-charged fixed expenses are excluded from the **bank-paid upcoming** reserve used in the Safe-to-Spend formula (they are already in `total_cc_outstanding`).

### How auto-processing works (`src/lib/utils/autoProcess.ts`)

1. On dashboard load, `runAutoProcess()` is called once per session (guarded by a `dashboardAutoRan` flag).
2. For each active fixed expense with `auto_count = true`, `getDueOccurrences(fe, today)` computes every month from `start_date` to today that falls within the `start_date`–`end_date` window.
3. Already-posted periods are detected by checking `transactions` for entries with matching `fixed_expense_id` and `period` (format: `YYYY-MM`).
4. Missing periods are batch-inserted in one Supabase call.
5. If 4 or more months would be back-filled at once, an optional `confirmBatch` callback can prompt the user before creating the entries.
6. The `last_processed_period` on the fixed expense is updated to the latest processed period.
7. The `safeDueDate()` helper clamps the due day to the actual number of days in the month (e.g., day 31 in June becomes June 30) to prevent invalid date errors.
8. The system is **idempotent**: running it multiple times never creates duplicate entries.

---

## 14. Budget Calculation Logic

`calculateBudgetStatus(budgets, transactions, income, fixedExpenses, statusDate, month, year)` returns a `BudgetStatus` for each active budget.

### Key concepts

**Daily budget pacing** (discretionary portion only):

```
daily_budget = (monthly_budget - fixed_bills_this_month) / days_in_month
allowed_till_date = posted_fixed_bills + (daily_budget × days_elapsed)
```

Fixed bills in the category (e.g., a Netflix subscription in the "Subscription" budget) are treated as lump sums. This prevents a budget from looking "red" on the 1st of the month simply because a bill landed on that date.

**Status logic:**

| Status | Condition |
|---|---|
| `grey` | Monthly budget is 0 |
| `green` | Discretionary actual ≤ discretionary allowed-till-date |
| `orange` | Discretionary actual > 90% of discretionary allowed-till-date |
| `red` | Discretionary actual > discretionary allowed-till-date, OR actual > monthly budget |

**Recovery per day:**

```
recovery_per_day = overspent / days_remaining
```

Shows how much you need to cut per day to get back on track by month end.

---

## 15. Goals Logic

`analyzeGoal(goal, availableSaving)` in `calculations.ts` produces a `GoalAnalysis`:

| Field | Calculation |
|---|---|
| `remaining_gap` | `max(0, expected_cost - availableSaving)` |
| `can_buy_now` | `availableSaving >= expected_cost` |
| `progress_percent` | `min(100, (availableSaving / expected_cost) × 100)` |
| `months_needed` | `ceil(remaining_gap / monthly_saving_plan)` |
| `risk_level` | `safe` if can buy and saving > 150% of cost; `moderate` if can buy or within 24 months; `not_ready` otherwise |

`availableSaving` is computed from the balances of all accounts flagged `include_in_goal_savings`. Goals are ordered by `priority` (1 = Critical, 5 = Optional).

---

## 16. Alerts Logic

`generateAlerts(budgetStatuses, balances, fixedExpenses, settings)` produces an array of `Alert` objects. Alert types:

| Alert Type | Trigger | Severity |
|---|---|---|
| `budget_exceeded` | `actual_till_date > monthly_budget` | error |
| `budget_overspent` | Discretionary spending ahead of daily pace | warning |
| `negative_balance` | Any non-CC account has balance < 0 | error |
| `high_cc_outstanding` | CC outstanding > ₹10,000 | warning |
| `fixed_expense_due` | Fixed expense due within 5 days | warning (error if due today) |

For `fixed_expense_due`, the due date is clamped to the real month length and the look-ahead wraps across month boundaries (a bill due on the 2nd of next month will alert from the 27th onwards).

The dashboard shows the top 3 alerts inline. The full list is on the Alerts page.

---

## 17. Test Cases (All 30)

The Test Results page runs 30 in-browser tests against your live data. Tests are defined in `src/app/dashboard/test-results/page.tsx`.

A test is **SKIPPED** when the required data hasn't been added yet (e.g., no salary income to validate salary logic). A **PASS** confirms accounting rules are correct. A **FAIL** shows actual vs expected values.

| # | Name | What It Tests |
|---|---|---|
| 1 | Initial Bank Balance | `initial_balance` transactions increase account balance but do NOT appear as income |
| 2 | Initial Cash Balance | Cash Wallet account exists and its balance is tracked |
| 3 | Initial CC Outstanding | `initial_cc_outstanding` transactions do NOT inflate expense totals |
| 4 | Salary Income | Salary entries are credited to bank/wallet accounts (not credit cards) |
| 5 | Salary Split (Regular + Variable) | Multiple salary entries per month are each tracked separately |
| 6 | Family/Home Money | Entries with `include_in_true_income = false` are excluded from True Income |
| 7 | Expense from Cash Wallet | Cash expense debits the Cash Wallet balance |
| 8 | Expense from Bank Account | Bank expense reduces bank account balance |
| 9 | Family/Home Expense | Family/shared expenses are tracked separately from personal expenses with no overlap |
| 10 | Credit Card Expense | CC expense increases CC outstanding; bank balance is unaffected until bill payment |
| 11 | Credit Card Bill Payment | CC payment reduces both bank balance and CC outstanding; NOT counted as expense |
| 12 | Friend Uses CC (CC→Bank Transfer) | A CC→Bank transfer increases CC outstanding and bank balance equally; no income/expense counted |
| 13 | Bill Payment for Friend Transaction (Net Zero) | After CC→Bank transfer + CC payment, net effect is zero on both accounts |
| 14 | Saving Transfer | Saving transactions move money without counting as expense |
| 15 | Existing Saving (Initial Balance) | Pre-existing savings set via `initial_balance` are not counted as income |
| 16 | Fixed Subscription via CC | CC-paid fixed expenses increase CC outstanding (bank unaffected until bill payment) |
| 17 | EMI End Date | Fixed expenses with `end_date` in the past are not auto-processed |
| 18 | Budget Allowed-Till-Date | `red` status is correctly assigned when actual > allowed_till_date or actual > monthly_budget |
| 19 | Budget Back on Track (Green) | `green` status is correctly assigned when actual ≤ allowed_till_date |
| 20 | Monthly Date Filter | Monthly filter returns only transactions within the selected month |
| 21 | Yearly Date Filter | Yearly filter returns only transactions within the selected year |
| 22 | Custom Date Range Filter | Custom range filter returns only transactions within the specified dates |
| 23 | Goal Planner — Car | Gap analysis: cost ₹14,00,000, savings ₹1,50,000 → gap ₹12,50,000, 63 months needed at ₹20,000/month |
| 24 | Goal Planner — TV (Can Buy Now) | When savings (₹1,50,000) > cost (₹60,000): `can_buy_now = true`, `remaining_gap = 0` |
| 25 | Deactivated Category | Inactive categories are hidden from dropdowns but historical transactions still reference them |
| 26 | Delete Unused Account | Accounts with no transactions can be hard-deleted |
| 27 | Delete Account with History | Accounts with transaction history are deactivated (not deleted) to preserve report accuracy |
| 28 | Responsive Mobile UI | Tailwind responsive classes exist; bottom nav on mobile; sidebar collapses |
| 29 | Theme & Font Settings | `font_choice` and `theme` are saved in `user_settings` and persist across sessions |
| 30 | Data Sync Across Devices | All data is in Supabase PostgreSQL with RLS; accessible from any device after login |

---

## 18. Deployment Guide

### Vercel (Recommended)

1. Push the project to GitHub:

```bash
git init && git add . && git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/money-control-system.git
git push -u origin main
```

2. Go to [vercel.com](https://vercel.com) → New Project → Import your repository.
3. Add environment variables in Vercel project settings:

| Key | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon key |

4. Click Deploy. Vercel auto-builds and deploys on every `git push`.
5. After deployment, update Supabase Auth URL Configuration with your Vercel domain.

### Netlify

```bash
npm run build
npm install -g netlify-cli
netlify deploy --prod --dir=.next
```

Add environment variables in Netlify → Site settings → Environment variables.

### Self-Host on Ubuntu/Debian VPS

```bash
# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2
npm install -g pm2

# Set up the project
git clone https://github.com/YOUR_USERNAME/money-control-system.git
cd money-control-system
npm install
cp .env.local.example .env.local
nano .env.local   # fill in Supabase keys

# Build and start
npm run build
pm2 start npm --name "money-control" -- start
pm2 save && pm2 startup
```

Optionally configure Nginx to reverse-proxy from port 80/443 to `localhost:3000`.

---

## 19. PWA Installation

The PWA manifest at `public/manifest.json` defines the app name, icons (8 sizes from 72×72 to 512×512), theme color (`#1d4ed8`), and two shortcuts (Add Transaction, View Dashboard).

To generate PNG icons from the SVG source:

```bash
npm install sharp --save-dev
node scripts/generate-icons.js
```

### Installing on Android (Chrome)

1. Open the app URL in Chrome.
2. Tap the three-dot menu → **Add to Home screen** → **Add**.

### Installing on iPhone (Safari)

1. Open the app URL in Safari.
2. Tap the Share button → **Add to Home Screen** → **Add**.

### Installing on Windows or Mac (Chrome / Edge)

1. Open the app in Chrome or Edge.
2. Click the install icon in the address bar → **Install**.

---

## 20. Configuration & Settings

### Environment Variables

See section 6.

### In-App Settings (Settings page, four tabs)

**Accounts tab:**

| Field | Description |
|---|---|
| Name | Display name |
| Account Type | Free-text; drives `accountRole()` classification |
| Owner / Purpose | Optional label |
| Is Credit Card | Enables CC accounting (outstanding tracking) |
| Is Spendable | Marks account as day-to-day spending money |
| Include in Goal Savings | Includes this account's balance in goal gap analysis |
| Include in Dashboard | Shows balance on dashboard account list |

**Categories tab:** Add/edit/deactivate categories. Type (`income`, `expense`, `transfer`, `saving`, `all`) determines where a category appears in dropdowns. `include_in_budget` controls whether it appears in budget tracking. Each category now also has an optional **Default Account** field: when set, the transaction form automatically pre-fills the "From Account" with that account whenever the category is selected. The "Routes to" column in the categories table shows the linked account name (or "—" if none is set). If the linked account is deleted, the association is cleared automatically.

**Owners tab:** Color-coded owner/purpose labels used to tag income and expense entries (e.g., Personal, Family, Business).

**Preferences tab:**

| Setting | Options | Default |
|---|---|---|
| Theme | light, dark, system | light |
| Font | DM Sans, Nunito, Inter, Outfit, Poppins | DM Sans |
| Currency | Any string (e.g., INR, USD) | INR |
| Currency Symbol | Any string (e.g., ₹, $) | ₹ |
| Date Format | Any format string | DD-MMM-YYYY |
| Month Start Day | 1–28 | 1 |
| Safe-to-Spend Buffer | Any amount | ₹5,000 |
| Dashboard View | monthly, yearly, custom | monthly |
| Auto-sweep on payday | on / off | on |

Theme and sidebar state are also persisted to `localStorage` via Zustand's `persist` middleware under the key `mcs-store`.

---

## 21. Development Commands

```bash
# Start development server with hot reload
npm run dev

# Type-check without building
npm run typecheck

# Lint code with ESLint
npm run lint

# Build for production
npm run build

# Start production build locally
npm start

# Generate PWA icons from SVG (requires sharp)
npm install sharp --save-dev
node scripts/generate-icons.js
```

---

## 22. Troubleshooting

### "Invalid API key" or blank screen
- Verify `.env.local` has the correct Supabase URL and anon key with no trailing spaces.
- Restart `npm run dev` after editing `.env.local`.

### "relation does not exist" error
- The database migrations have not been run. Go to Supabase → SQL Editor and run both migration files in order.

### Data not showing after login
- Clear browser cache or open in a private/incognito window.
- Check Supabase → Authentication → Users to confirm your user record exists.

### Auth redirect loop after deployment
- Add your production URL and `/auth/callback` path to Supabase → Authentication → URL Configuration → Redirect URLs.

### Build fails on Vercel
- Check that `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set in Vercel project settings.
- Check the build log for TypeScript errors (`npm run typecheck` locally first).

### Dashboard shows "Loading..." forever
- Open browser DevTools → Console — look for Supabase connection errors.
- Free-tier Supabase projects pause after one week of inactivity. Go to the Supabase dashboard and click **Restore Project**.

### PWA icons missing after install
- Run `node scripts/generate-icons.js` to generate the PNG files, then redeploy.

### Fixed expense keeps getting re-posted
- Check that the auto-processor did not encounter an error — look for entries in the `errors` array from `runAutoProcess`.
- The safety-net unique index on `(fixed_expense_id, period)` prevents real duplicates even if the deduplication check in code fails.

---

## 23. Contributing

The codebase follows these conventions:

- **All financial logic belongs in `calculations.ts`.** Pages and components should call the exported functions; they should not compute totals inline.
- **State mutations go through the Zustand store.** After any Supabase insert/update/delete, call the matching store action (`addTransaction`, `updateAccount`, etc.) to keep the UI in sync without a full page reload.
- **Account roles drive every classification.** If you need to distinguish account types in a new feature, use `accountRole(account)` rather than pattern-matching on name strings.
- **Fixed expenses must be idempotent.** Any code that auto-generates transactions must check the `(fixed_expense_id, period)` pair before inserting.
- **RLS is the security boundary.** Do not rely on client-side filtering as a security measure — always query with the user's Supabase session so RLS applies.

Pull requests should include:
- TypeScript types for any new data shapes added to `types/index.ts`
- Updated test cases in `test-results/page.tsx` if new accounting logic is introduced
- No hardcoded user IDs, amounts, or locale strings — use the user's `settings` from the store

---

## License

MIT — free to use personally or commercially.

---

## Built With

- [Next.js](https://nextjs.org)
- [Supabase](https://supabase.com)
- [Tailwind CSS](https://tailwindcss.com)
- [Recharts](https://recharts.org)
- [Lucide Icons](https://lucide.dev)
- [Zustand](https://zustand-demo.pmnd.rs)
