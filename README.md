# 💰 Money Control System

A complete, production-ready personal finance web app built with **Next.js 14, TypeScript, Tailwind CSS, and Supabase**. Track income, expenses, budgets, credit cards, savings, and goals — all in one place, synced across all your devices.

---

## ✨ Features

| Module | What it does |
|---|---|
| **Dashboard** | KPI cards, trend charts, budget status, real-time alerts |
| **Income** | Track salary, bonus, family money, reimbursements separately |
| **Transactions** | All 8 transaction types with full accounting logic |
| **Fixed Expenses** | Recurring payments, EMIs, subscriptions with auto-processing |
| **Budget** | Category limits, daily allowance, green/red status |
| **Goals** | Car, TV, travel — can-I-afford-it planner with gap analysis |
| **Reports** | Monthly, yearly, custom date range with CSV export |
| **Alerts** | Real-time budget, CC, and cash flow warnings |
| **Settings** | Accounts, categories, owners, theme, font, currency |
| **Test Results** | All 30 spec test cases with PASS/FAIL/SKIPPED status |

---

## 🗂 Project Structure

```
money-control-system/
├── src/
│   ├── app/
│   │   ├── auth/
│   │   │   ├── login/page.tsx          ← Login page
│   │   │   ├── register/page.tsx       ← Register page
│   │   │   └── callback/route.ts       ← OAuth callback
│   │   ├── dashboard/
│   │   │   ├── layout.tsx              ← Sidebar + mobile nav
│   │   │   ├── page.tsx                ← Main dashboard
│   │   │   ├── income/page.tsx
│   │   │   ├── transactions/page.tsx
│   │   │   ├── fixed-expenses/page.tsx
│   │   │   ├── budget/page.tsx
│   │   │   ├── goals/page.tsx
│   │   │   ├── reports/page.tsx
│   │   │   ├── alerts/page.tsx
│   │   │   ├── settings/page.tsx
│   │   │   └── test-results/page.tsx
│   │   ├── api/health/route.ts
│   │   ├── globals.css
│   │   └── layout.tsx
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts               ← Browser Supabase client
│   │   │   └── server.ts               ← Server Supabase client
│   │   ├── store/
│   │   │   └── appStore.ts             ← Zustand global state
│   │   └── utils/
│   │       └── calculations.ts         ← All financial logic
│   ├── types/index.ts                  ← All TypeScript types
│   └── middleware.ts                   ← Auth route protection
├── supabase/
│   ├── migrations/
│   │   ├── 001_initial_schema.sql      ← Tables, RLS, defaults
│   │   └── 002_views_and_functions.sql ← Views & DB functions
│   └── seed_demo.sql                   ← Optional demo data
├── public/
│   ├── manifest.json                   ← PWA manifest
│   ├── favicon.svg
│   └── icons/icon.svg
├── scripts/
│   └── generate-icons.js              ← PWA icon generator
├── .env.local.example
└── README.md
```

---

## 🚀 Installation Guide

### Prerequisites

Make sure you have these installed:

| Tool | Version | Check |
|---|---|---|
| Node.js | 18.17 or later | `node --version` |
| npm | 9 or later | `npm --version` |
| Git | Any | `git --version` |

You also need a free **Supabase** account at [supabase.com](https://supabase.com).

---

### Step 1 — Download the Project

**Option A — Clone from Git (recommended)**
```bash
git clone https://github.com/YOUR_USERNAME/money-control-system.git
cd money-control-system
```

**Option B — Download ZIP**
1. Download the project ZIP
2. Extract it somewhere (e.g. `~/projects/money-control-system`)
3. Open a terminal and `cd` into that folder

---

### Step 2 — Set Up Supabase

#### 2.1 Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign in
2. Click **"New Project"**
3. Fill in:
   - **Name:** `money-control-system` (or anything you like)
   - **Database Password:** choose a strong password and save it
   - **Region:** choose the one closest to you
4. Click **"Create new project"** and wait ~2 minutes

#### 2.2 Get Your API Keys

1. In your Supabase project, go to **Settings → API**
2. Copy these two values:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **anon public key** (long string starting with `eyJ...`)

#### 2.3 Configure Supabase Auth

1. Go to **Authentication → Providers**
2. Make sure **Email** is enabled (it is by default)
3. Go to **Authentication → URL Configuration**
4. Set **Site URL** to:
   - Local dev: `http://localhost:3000`
   - Production: `https://your-domain.com`
5. Add to **Redirect URLs**:
   - `http://localhost:3000/auth/callback`
   - `https://your-domain.com/auth/callback` (for production)

#### 2.4 Run the Database Migrations

1. In Supabase, go to **SQL Editor**
2. Click **"New query"**
3. Open `supabase/migrations/001_initial_schema.sql` from the project folder
4. Copy the entire contents and paste into the SQL Editor
5. Click **"Run"** — you should see "Success"
6. Click **"New query"** again
7. Open `supabase/migrations/002_views_and_functions.sql`
8. Copy, paste, and click **"Run"**

✅ Your database is now set up with all tables, Row Level Security, and auto-provisioning of default data on signup.

---

### Step 3 — Configure the App

#### 3.1 Create Your `.env.local` File

In your project root, create a file called `.env.local`:

```bash
# On Mac/Linux:
cp .env.local.example .env.local

# On Windows:
copy .env.local.example .env.local
```

#### 3.2 Fill In Your Supabase Keys

Open `.env.local` in any text editor and replace the placeholders:

```env
NEXT_PUBLIC_SUPABASE_URL=https://abcdefghijkl.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

> ⚠️ **Important:** Never share these values publicly or commit `.env.local` to Git.
> The `anon` key is safe for frontend use — it's protected by Row Level Security.

---

### Step 4 — Install Dependencies

In your project folder, run:

```bash
npm install
```

This downloads all required packages (~200 MB). It takes 1–3 minutes.

---

### Step 5 — Run Locally

```bash
npm run dev
```

Open your browser and go to: **http://localhost:3000**

You should see the login page. Click **"Create one free"** to register your account.

---

### Step 6 — First-Time Setup In The App

After registering, the app auto-creates default accounts, categories, and owners. Then:

1. **Go to Settings → Accounts**
   - Review the default accounts (Main Bank Account, Cash Wallet, Credit Card 1, etc.)
   - Edit names to match your real accounts
   - Add your actual credit cards and savings accounts
   - Mark savings accounts as **"Include in Goal Savings"**

2. **Go to Transactions → Add Transaction**
   - Add **Initial Balance** entries for each account (your current balance)
   - Add **Initial CC Outstanding** for any credit cards you already owe on

3. **Go to Budget → Add Budget**
   - Set monthly limits for each spending category

4. **Go to Income → Add Income**
   - Add your salary for the current month

5. **Go to Test Results → Run All 30 Tests**
   - Verify the system is working correctly

---

### Step 7 — Load Demo Data (Optional)

To see the app populated with realistic example data:

1. Register in the app and log in
2. Go to Supabase → **Authentication → Users**
3. Copy your **User ID** (UUID format)
4. Open `supabase/seed_demo.sql` in a text editor
5. Replace `YOUR-USER-UUID-HERE` with your actual user ID
6. Go to Supabase → **SQL Editor → New query**
7. Paste the modified SQL and click **Run**
8. Refresh the app — you'll see demo accounts, income, transactions, budgets, and goals

---

## 🌐 Deployment Guide

### Deploy to Vercel (Recommended — Free)

Vercel is the fastest way to deploy a Next.js app publicly.

#### Step 1 — Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit: Money Control System"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/money-control-system.git
git push -u origin main
```

#### Step 2 — Deploy on Vercel

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub
2. Click **"New Project"**
3. Select your `money-control-system` repository
4. Click **"Import"**
5. In **Environment Variables**, add:

   | Key | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon key |

6. Click **"Deploy"**
7. Wait ~2 minutes — Vercel builds and deploys automatically

#### Step 3 — Update Supabase Auth URLs

After Vercel gives you a URL (e.g. `https://money-control-system.vercel.app`):

1. Go to Supabase → **Authentication → URL Configuration**
2. Set **Site URL** to your Vercel URL
3. Add your Vercel URL + `/auth/callback` to **Redirect URLs**

Your app is now live! 🎉

---

### Deploy to Netlify

```bash
# Build the app
npm run build

# Install Netlify CLI
npm install -g netlify-cli

# Deploy
netlify deploy --prod --dir=.next
```

Add environment variables in Netlify → Site settings → Environment variables.

---

### Self-Host on a VPS (Ubuntu/Debian)

```bash
# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 process manager
npm install -g pm2

# Clone and set up
git clone https://github.com/YOUR_USERNAME/money-control-system.git
cd money-control-system
npm install
cp .env.local.example .env.local
nano .env.local  # fill in your Supabase keys

# Build
npm run build

# Start with PM2
pm2 start npm --name "money-control" -- start
pm2 save
pm2 startup

# (Optional) Nginx reverse proxy on port 80/443
sudo apt install nginx
# Configure /etc/nginx/sites-available/money-control to proxy to localhost:3000
```

---

## 📱 Install as Mobile App (PWA)

### On Android (Chrome)
1. Open the app URL in Chrome
2. Tap the **⋮** menu → **"Add to Home screen"**
3. Tap **"Add"**

### On iPhone (Safari)
1. Open the app URL in Safari
2. Tap the **Share** button (box with arrow)
3. Scroll down and tap **"Add to Home Screen"**
4. Tap **"Add"**

### On Windows/Mac (Chrome/Edge)
1. Open the app in Chrome or Edge
2. Click the **install icon** in the address bar (looks like a computer with +)
3. Click **"Install"**

---

## 🔧 Configuration Reference

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ Yes | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ Yes | Your Supabase anonymous/public key |

> Only `NEXT_PUBLIC_` prefixed variables are exposed to the browser.
> The anon key is safe to expose — all data access is governed by Row Level Security.

### App Settings (In-App)

All other settings are configured inside the app under **Settings**:

| Setting | Location | Default |
|---|---|---|
| Theme | Settings → Preferences | Light |
| Font | Settings → Preferences | DM Sans |
| Currency | Settings → Preferences | INR (₹) |
| Safe-to-Spend Buffer | Settings → Preferences | ₹5,000 |
| Accounts | Settings → Accounts | 7 defaults |
| Categories | Settings → Categories | 35 defaults |
| Owners | Settings → Owners | 8 defaults |

---

## 🗄 Database Schema

### Tables

| Table | Purpose |
|---|---|
| `accounts` | Bank accounts, wallets, credit cards, savings |
| `account_types` | Configurable account type names |
| `categories` | Income/expense categories |
| `owners` | Owner/purpose labels (Personal, Family, etc.) |
| `income_sources` | Source names (Employer, Bank, etc.) |
| `income` | All income transactions |
| `transactions` | All other transactions (expense, transfer, CC payment, saving, etc.) |
| `fixed_expenses` | Recurring payment templates |
| `budget` | Monthly category budgets |
| `goals` | Future purchase planning |
| `user_settings` | Per-user preferences |
| `alerts_log` | System-generated alert history |

### Security

- **Row Level Security (RLS)** is enabled on every table
- Every query filters by `auth.uid() = user_id`
- No user can ever see another user's data
- The `anon` key cannot bypass RLS
- No service-role key is used in the frontend

---

## 🧪 Running the 30 Test Cases

1. Open the app and go to **Test Results** in the sidebar
2. Click **"Run All 30 Tests"**
3. Each test shows **PASS**, **FAIL**, or **SKIPPED** with a reason

Tests cover:
- Initial balance (not counted as income)
- Initial CC outstanding (not counted as expense)
- Salary split tracking
- Family money excluded from True Income
- Expense from bank, cash, credit card
- CC bill payment (prevents double counting)
- Pass-through reimbursement (net zero)
- Saving transfer (not an expense)
- Fixed expense end date (EMI stops after end date)
- Budget allowed-till-date calculation (green/red)
- Goal planner (car: not ready, TV: can buy now)
- Deactivated category (history preserved)
- Delete account with history (deactivated, not deleted)
- Responsive UI validation
- Theme/font persistence
- Data sync across devices

A **SKIPPED** result means the test requires data that hasn't been added yet — follow the instruction in the test to add it.

---

## 🛠 Development Commands

```bash
# Start development server with hot reload
npm run dev

# Check TypeScript types (no build)
npm run typecheck

# Lint code
npm run lint

# Build for production
npm run build

# Start production server locally
npm start

# Generate PWA icons (requires: npm install sharp --save-dev)
node scripts/generate-icons.js
```

---

## 🔄 Updating the App

```bash
git pull origin main
npm install          # in case dependencies changed
npm run build        # rebuild
# Vercel auto-deploys on git push — no manual step needed
```

---

## 🐛 Troubleshooting

### "Invalid API key" or blank screen
- Check `.env.local` has the correct Supabase URL and anon key
- Restart `npm run dev` after changing `.env.local`
- Make sure there are no trailing spaces in your env values

### "relation does not exist" error
- The database migrations haven't been run
- Go to Supabase → SQL Editor and run both migration files

### Data not showing after login
- Clear browser cache or open in incognito
- Check Supabase → Authentication → Users to confirm your user exists

### Auth redirect not working after deploy
- Add your production URL to Supabase → Authentication → URL Configuration → Redirect URLs

### Build fails on Vercel
- Check that environment variables are set in Vercel project settings
- Check the build logs for specific TypeScript errors

### App shows "Loading..." forever
- Open browser DevTools → Console — check for Supabase connection errors
- Verify the Supabase project is active (free tier pauses after 1 week of inactivity — click "Restore" in Supabase dashboard)

---

## 📦 Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 3 |
| State | Zustand 4 |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| Charts | Recharts 2 |
| Icons | Lucide React |
| Forms | React Hook Form + Zod |
| Date | date-fns 3 |
| Export | PapaParse (CSV) |
| Hosting | Vercel (recommended) |
| PWA | next-pwa (optional) |

---

## 🔐 Security Notes

- Never commit `.env.local` to version control
- The Supabase `anon` key is safe to expose in the browser — it's designed for that
- Never use the `service_role` key in the frontend
- Row Level Security ensures complete data isolation between users
- All routes under `/dashboard` are protected by middleware

---

## 📄 License

MIT License — free to use personally or commercially.

---

## 🙌 Built With

- [Next.js](https://nextjs.org)
- [Supabase](https://supabase.com)
- [Tailwind CSS](https://tailwindcss.com)
- [Recharts](https://recharts.org)
- [Lucide Icons](https://lucide.dev)
