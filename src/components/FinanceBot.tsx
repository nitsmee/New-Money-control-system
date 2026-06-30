'use client';
import { useState, useRef, useEffect, useMemo } from 'react';
import { Bot, X, Send, Sparkles, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  subDays, subMonths, subWeeks, subYears, startOfYear, endOfYear,
  getDay, startOfDay, addMonths,
} from 'date-fns';
import { useAppStore } from '@/lib/store/appStore';
import { createClient } from '@/lib/supabase/client';
import {
  calculateAccountBalances, calculateDashboardKPIs, calculateBudgetStatus,
  formatCurrency, getMonthTotals, currencySymbol, accountRole, convertAmount,
  CURRENCY_SYMBOLS,
} from '@/lib/utils/calculations';
import type {
  Account, Transaction, Income, Category, Goal, Budget, FixedExpense,
  UserSettings, DashboardKPIs, DateFilter, AccountBalance,
} from '@/types';

// ============================================================
// SHARED HELPERS
// ============================================================

interface Entry { amount: number; date: string; description?: string | null; category?: string | null; source?: string | null; type?: string; }

const sum = (items: Entry[]) => items.reduce((s, x) => s + (x.amount || 0), 0);
const descOf = (e: Entry) => e.description || e.category || e.source || '';
const eq = (a: string | null | undefined, b: string) => (a || '').toLowerCase() === b.toLowerCase();
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fmt = (d: Date) => format(d, 'yyyy-MM-dd');

// Light typo/synonym tolerance. Produces an alternate phrasing of the query
// that maps common natural words onto the vocabulary the matchers already
// understand. Used only as a SECOND attempt, so it never changes the meaning
// of a query the existing handlers already answer correctly.
const SYNONYMS: [RegExp, string][] = [
  [/\bspendings?\b/g, 'expense'],
  [/\bexpenditures?\b/g, 'expense'],
  [/\boutgoings?\b/g, 'expense'],
  [/\bearnings?\b/g, 'income'],
  [/\bsalary\b/g, 'income'],
  [/\bwages?\b/g, 'income'],
  [/\bpaychecks?\b/g, 'income'],
  [/\bset aside\b/g, 'saving'],
  [/\bput aside\b/g, 'saving'],
  [/\bsaved\b/g, 'saving'],
  [/\bsavings\b/g, 'saving'],
  [/\bhow much do i have\b/g, 'balance'],
  [/\bhow much have i got\b/g, 'balance'],
  [/\blatest\b/g, 'recent'],
  [/\bmost recent\b/g, 'recent'],
];
function normalizeQuery(q: string): string {
  return SYNONYMS.reduce((s, [re, to]) => s.replace(re, to), q);
}

// ============================================================
// CONCEPTUAL KNOWLEDGE BASE ("how is X calculated")
// ============================================================

interface KBEntry { keywords: string[]; title: string; formula?: string; explanation: string; example?: string; }

const KNOWLEDGE_BASE: KBEntry[] = [
  { keywords: ['safe to spend', 'how much can i spend', 'spend safely'], title: 'Safe to Spend',
    formula: 'Spendable Balance − Bank-paid Upcoming Bills − Total CC Outstanding − Safe Spend Buffer',
    explanation: 'The most conservative estimate of freely-available cash. Starts with your cash accounts, then deducts upcoming bank-paid bills, all credit card outstanding, and your safety buffer.',
    example: 'Spendable ₹80,000 − Upcoming ₹12,000 − CC ₹8,000 − Buffer ₹5,000 = ₹55,000' },
  { keywords: ['savings rate', 'saving rate', 'saving percent'], title: 'Savings Rate',
    formula: 'min(100, (Total Savings ÷ True Income) × 100)',
    explanation: 'What percentage of your true income you set aside this month. Uses True Income so gifts and reimbursements don\'t inflate it.',
    example: 'Saved ₹20,000, True Income ₹100,000 → 20%' },
  { keywords: ['true income', 'real income'], title: 'True Income',
    formula: 'Sum of income where "Include in True Income" is on',
    explanation: 'Only money you genuinely earned — salary, freelance, business. Excludes one-off family money, reimbursements, and gifts.',
    example: 'Salary ₹90,000 + Freelance ₹10,000 (reimbursement ₹3,000 excluded) = ₹100,000' },
  { keywords: ['net cashflow', 'cashflow', 'cash flow'], title: 'Net Cashflow',
    formula: 'Total Income − Total Expenses − Total Savings',
    explanation: 'What remains after all spending and money moved to savings this month. Positive = money left over.',
    example: 'Income ₹100,000 − Expenses ₹60,000 − Savings ₹20,000 = ₹20,000' },
  { keywords: ['budget status', 'allowed till date', 'daily budget'], title: 'Budget: Allowed Till Date',
    formula: 'Posted Fixed Bills + (Discretionary Daily Rate × Days Elapsed)',
    explanation: 'Compares actual spend vs what you were allowed up to today. Fixed bills count as lump sums; only the discretionary part is paced daily.',
    example: 'Budget ₹30,000, fixed ₹10,000 → ₹667/day. Day 15: allowed ₹20,000' },
  { keywords: ['projected', 'forecast', 'end of month'], title: 'Projected Month-End',
    formula: 'Posted Fixed Bills + (Discretionary Daily Rate × Days in Month)',
    explanation: 'Extrapolates your discretionary pace across the full month and adds fixed bills.',
    example: 'Fixed ₹10,000 + ₹500/day × 30 = ₹25,000' },
  { keywords: ['how is balance calculated', 'how balance works'], title: 'Account Balance',
    explanation: 'Every account replays all transactions: income credits, expenses debit. For credit cards the sign flips — positive outstanding means you OWE.',
    example: '₹0 + income ₹100,000 − expense ₹20,000 = ₹80,000' },
  { keywords: ['cc outstanding', 'credit card outstanding', 'card debt'], title: 'Credit Card Outstanding',
    formula: 'Initial + CC Purchases − Bill Payments − Transfers to Card',
    explanation: 'How much you owe on each card right now. Purchases increase it; payments and transfers to the card decrease it.',
    example: 'Opening ₹5,000 + ₹8,000 − ₹10,000 = ₹3,000' },
  { keywords: ['goal progress', 'progress percent', 'how close am i'], title: 'Goal Progress',
    formula: 'min(100, (Available Savings ÷ Expected Cost) × 100)',
    explanation: 'How much of a goal you\'ve saved. Goals draw from a shared savings pool in priority order.',
    example: 'Cost ₹50,000, available ₹30,000 → 60%' },
  { keywords: ['month over month', 'mom delta', 'vs last month', 'the arrow'], title: 'Month-over-Month Delta',
    formula: 'Current Month Value − Previous Month Value',
    explanation: 'The ▲/▼ arrows compare this month to last. Green = improvement, red = worse.',
    example: 'Income ₹90,000 → ₹100,000 = ▲ ₹10,000 (green)' },
  { keywords: ['spendable', 'cash accounts'], title: 'Spendable Balance',
    formula: 'Sum of active cash-type accounts shown on dashboard',
    explanation: 'Your day-to-day pool. Excludes savings, investments, family accounts, and credit cards.',
    example: 'HDFC ₹50,000 + ICICI ₹30,000 = ₹80,000' },
  { keywords: ['upcoming fixed', 'upcoming bills', 'bills due'], title: 'Upcoming Fixed Expenses',
    explanation: 'Recurring bills due this month not yet posted. Excludes already-posted, not-yet-started, and expired ones.',
    example: 'Rent ₹15,000 + Electricity ₹2,000 = ₹17,000' },
  { keywords: ['payday sweep', 'auto sweep'], title: 'Payday Sweep',
    explanation: 'When salary lands, leftover from the previous month is offered to move to savings, so old money doesn\'t inflate Safe to Spend.',
    example: 'Leftover ₹12,000 → auto-moved to Savings on payday' },
  { keywords: ['family expense', 'personal expense'], title: 'Family vs Personal Expense',
    explanation: 'Each expense is family or personal based on the source account (family/shared/joint = family).',
    example: 'Grocery from Joint Account = Family; Dinner from HDFC = Personal' },
  { keywords: ['net worth', 'investment'], title: 'Investments & Net Worth',
    formula: 'Net Worth = Cash + Savings + Investments − CC Outstanding',
    explanation: 'Investment accounts only count toward Net Worth, not Spendable or Savings.',
    example: 'Cash ₹80k + Savings ₹120k + Invest ₹300k − CC ₹8k = ₹492k' },
];

// ============================================================
// APP HELP / HOW-TO
// ============================================================

interface HelpEntry { keywords: string[]; title: string; steps: string; }

const HELP: HelpEntry[] = [
  { keywords: ['add a transaction', 'add transaction', 'record expense', 'log expense', 'enter transaction', 'new transaction', 'add expense', 'add an expense'],
    title: 'Add a Transaction',
    steps: '1. Open **Transactions** (or press T).\n2. Click **Add Transaction** at the top-right — or tap the green ➕ button at the bottom-right for a quick entry.\n3. Choose the type (Expense, Transfer, Saving, CC Payment…).\n4. Fill in date, amount, category, and the account.\n5. Click **Add** — your balances and budgets update instantly.' },
  { keywords: ['add an account', 'add account', 'create account', 'new account', 'set up account'],
    title: 'Add an Account',
    steps: '1. Open **Settings → Accounts**.\n2. Click **Add Account**.\n3. Enter a name, pick the type (bank / savings / credit card / cash), and toggle flags like "Show on Dashboard".\n4. Save. To set its starting balance, add an **Initial Balance** transaction.' },
  { keywords: ['set a budget', 'add budget', 'create budget', 'make a budget', 'how to budget'],
    title: 'Set a Budget',
    steps: '1. Open **Budget** (or press B).\n2. Click **Add Budget**.\n3. Pick a category and a monthly limit.\n4. Save. The app paces it day-by-day and warns you before you overspend.' },
  { keywords: ['add a goal', 'create goal', 'new goal', 'savings goal', 'set a goal'],
    title: 'Add a Goal',
    steps: '1. Open **Goals** (or press G).\n2. Click **Add Goal**.\n3. Enter a name, expected cost, and optionally a monthly saving plan.\n4. Save — then just ask me "can I afford it?"' },
  { keywords: ['import csv', 'import bank', 'upload statement', 'import transactions'],
    title: 'Import a CSV',
    steps: '1. Open **Transactions**.\n2. Click **Import CSV**.\n3. Upload your bank file, map the Date / Amount / Description columns, choose an account, preview, and import.' },
  { keywords: ['recurring income', 'automatic income', 'income template', 'monthly salary setup'],
    title: 'Add Recurring Income',
    steps: '1. Open **Recurring Income**.\n2. Click **Add Recurring Income**.\n3. Set amount, account, and due day.\n4. It auto-creates an income entry every month on that day.' },
  { keywords: ['export', 'backup', 'download my data', 'save my data'],
    title: 'Export / Backup',
    steps: '1. Open **Settings → Preferences** (or the Export button in the header).\n2. Click **Export All Data (JSON)** for a full backup of everything.' },
  { keywords: ['fixed expense', 'recurring payment', 'add emi', 'add subscription', 'recurring bill'],
    title: 'Add a Fixed Expense',
    steps: '1. Open **Fixed Expenses**.\n2. Click **Add Fixed Expense**.\n3. Set amount, due day, category, and start/end dates.\n4. It auto-posts each month so your budget stays accurate.' },
];

const CAPABILITIES =
  "I'm your Finance Bot 🤖 — I read your real data and can help with:\n\n📊 **Your numbers** — \"how much did I spend last Sunday?\", \"summary of this month\", \"biggest expense in June\", \"balance of all accounts\", \"how many accounts do I have?\"\n\n💡 **Explanations** — \"what's my safe to spend?\", \"how is savings rate calculated?\"\n\n🚗 **Decisions** — \"can I afford a car for ₹8 lakh?\"\n\n🧭 **How-to** — \"how do I add a transaction?\"\n\nAsk me anything!";

const QUICK_CHIPS = [
  'Can I afford a car for ₹8 lakh?',
  'How do I add a transaction?',
  'How many accounts do I have?',
  "What's my safe to spend?",
  'Summary of this month',
];

// ============================================================
// AMOUNT PARSER (handles ₹, lakh, crore, k)
// ============================================================

function parseAmount(q: string): number | null {
  const crore = q.match(/(\d+(?:\.\d+)?)\s*(?:crore|cr)\b/);
  if (crore) return Math.round(parseFloat(crore[1]) * 10000000);
  const lakh = q.match(/(\d+(?:\.\d+)?)\s*(?:lakhs?|lacs?|l)\b/);
  if (lakh) return Math.round(parseFloat(lakh[1]) * 100000);
  const k = q.match(/(\d+(?:\.\d+)?)\s*k\b/);
  if (k) return Math.round(parseFloat(k[1]) * 1000);
  const plain = q.match(/(?:₹|rs\.?|inr)?\s*([\d,]{2,})(?:\.\d+)?/);
  if (plain) { const n = parseInt(plain[1].replace(/,/g, ''), 10); if (!isNaN(n) && n >= 100) return n; }
  return null;
}

// ============================================================
// DATE RANGE PARSER
// ============================================================

interface DateRange { start: string; end: string; label: string; }

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, thursday: 4, thu: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
};
const MONTHS: Record<string, number> = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3, may: 4,
  june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7, september: 8, sept: 8, sep: 8,
  october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11,
};

function parseDateRange(q: string, today = new Date()): DateRange | null {
  const t = startOfDay(today);
  if (/\btoday\b/.test(q)) return { start: fmt(t), end: fmt(t), label: 'today' };
  if (/\byesterday\b/.test(q)) { const d = subDays(t, 1); return { start: fmt(d), end: fmt(d), label: 'yesterday' }; }

  const nDays = q.match(/\b(?:last|past|previous)\s+(\d+)\s+days?\b/);
  if (nDays) { const n = +nDays[1]; return { start: fmt(subDays(t, n - 1)), end: fmt(t), label: `last ${n} days` }; }

  if (/\blast weekend\b/.test(q)) {
    const dow = getDay(t); const lastSun = subDays(t, dow === 0 ? 7 : dow); const lastSat = subDays(lastSun, 1);
    return { start: fmt(lastSat), end: fmt(lastSun), label: 'last weekend' };
  }
  const wd = q.match(/\b(last|this|previous|past)\s+(sunday|sun|monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thurs|friday|fri|saturday|sat)\b/);
  if (wd) {
    const target = WEEKDAYS[wd[2]]; const dow = getDay(t);
    let diff = (dow - target + 7) % 7; // 0..6 = most recent occurrence incl. today
    const qualifier = wd[1];
    // "last/previous/past <day>" on the same weekday means a full week ago.
    if (diff === 0 && qualifier !== 'this') diff = 7;
    const d = subDays(t, diff); return { start: fmt(d), end: fmt(d), label: `${qualifier} ${cap(wd[2])}` };
  }
  const bareWd = q.match(/\b(?:on\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (bareWd) {
    const target = WEEKDAYS[bareWd[1]]; const dow = getDay(t);
    const diff = (dow - target + 7) % 7; // most recent occurrence incl. today
    const d = subDays(t, diff); return { start: fmt(d), end: fmt(d), label: cap(bareWd[1]) + (diff === 0 ? ' (today)' : '') };
  }
  if (/\bthis week\b/.test(q)) return { start: fmt(startOfWeek(t, { weekStartsOn: 1 })), end: fmt(endOfWeek(t, { weekStartsOn: 1 })), label: 'this week' };
  if (/\b(last|previous|past) week\b/.test(q)) { const w = subWeeks(t, 1); return { start: fmt(startOfWeek(w, { weekStartsOn: 1 })), end: fmt(endOfWeek(w, { weekStartsOn: 1 })), label: 'last week' }; }
  if (/\bthis month\b/.test(q)) return { start: fmt(startOfMonth(t)), end: fmt(endOfMonth(t)), label: 'this month' };
  if (/\b(last|previous|past) month\b/.test(q)) { const d = subMonths(t, 1); return { start: fmt(startOfMonth(d)), end: fmt(endOfMonth(d)), label: 'last month' }; }
  if (/\bthis year\b/.test(q)) return { start: fmt(startOfYear(t)), end: fmt(endOfYear(t)), label: 'this year' };
  if (/\b(last|previous|past) year\b/.test(q)) { const d = subYears(t, 1); return { start: fmt(startOfYear(d)), end: fmt(endOfYear(d)), label: 'last year' }; }

  const mon = q.match(/\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\b\.?\s*(\d{4})?/);
  if (mon) {
    const token = mon[1];
    const hasYear = !!mon[2];
    // "may" is also a common modal verb ("how much may I spend"). Only treat
    // it as the month May when it has a year or an explicit date preposition.
    const ambiguousMay = token === 'may' && !hasYear && !/\b(in|of|during|for|month of)\s+may\b/.test(q);
    if (!ambiguousMay) {
      const mIdx = MONTHS[token];
      const yr = hasYear ? +mon[2] : (mIdx > t.getMonth() ? t.getFullYear() - 1 : t.getFullYear());
      const s = new Date(yr, mIdx, 1);
      return { start: fmt(s), end: fmt(endOfMonth(s)), label: format(s, 'MMMM yyyy') };
    }
  }
  // Bare 4-digit year — but not when it's actually an amount ("2020 rupees", "₹2020").
  const yrMatch = q.match(/\b(20\d{2})\b/);
  if (yrMatch) {
    const idx = yrMatch.index ?? 0;
    const after = q.slice(idx + 4, idx + 14);
    const before = q.slice(Math.max(0, idx - 2), idx);
    if (!/^\s*(rupees?|rs|inr|bucks|dollars?)\b/.test(after) && !/[₹$]/.test(before)) {
      const yr = +yrMatch[1];
      return { start: `${yr}-01-01`, end: `${yr}-12-31`, label: String(yr) };
    }
  }
  return null;
}
const daysInRange = (r: DateRange) => Math.round((new Date(r.end).getTime() - new Date(r.start).getTime()) / 86400000) + 1;

// ============================================================
// INTENT + ENTITY
// ============================================================

type Intent = 'count' | 'sum' | 'summary' | 'list' | 'top' | 'average' | 'balance' | 'unknown';
type EntityType = 'expense' | 'income' | 'saving' | 'transfer' | 'cc_payment' | 'transaction';

function classifyIntent(q: string): Intent {
  if (/\b(summary|summari[sz]e|overview|recap|breakdown|how did i do|what happened)\b/.test(q)) return 'summary';
  if (/\b(how many|number of|count of|count)\b/.test(q)) return 'count';
  if (/\b(biggest|largest|highest|top|most expensive|maximum|smallest|lowest|max)\b/.test(q)) return 'top';
  if (/\b(average|avg|mean|per day|typical)\b/.test(q)) return 'average';
  if (/\b(balance|how much.*(do i have|in my|left in)|what.*balance|money in)\b/.test(q)) return 'balance';
  if (/\b(list|show me|show all|which|what.*(transactions|expenses|did i (spend|buy)))\b/.test(q)) return 'list';
  if (/\b(how much|total|sum|spent|spend|spending|earned|saved|did i pay)\b/.test(q)) return 'sum';
  return 'unknown';
}
function classifyEntity(q: string): EntityType {
  if (/\b(cc payment|card payment|credit card payment|bill payment)\b/.test(q)) return 'cc_payment';
  if (/\b(income|earned|earning|got paid|received)\b/.test(q)) return 'income';
  if (/\bsavings?\b|\bsaved\b/.test(q)) return 'saving';
  if (/\b(transfer|transferred|moved money)\b/.test(q)) return 'transfer';
  if (/\b(expense|expenses|spent|spend|spending|bought|purchase|paid for|cost)\b/.test(q)) return 'expense';
  return 'transaction';
}
function pickEntity(entity: EntityType, tx: Transaction[], inc: Income[]): { items: Entry[]; noun: string } {
  switch (entity) {
    case 'expense': return { items: tx.filter(t => t.type === 'expense') as unknown as Entry[], noun: 'expense' };
    case 'saving': return { items: tx.filter(t => t.type === 'saving') as unknown as Entry[], noun: 'saving' };
    case 'transfer': return { items: tx.filter(t => t.type === 'transfer') as unknown as Entry[], noun: 'transfer' };
    case 'cc_payment': return { items: tx.filter(t => t.type === 'credit_card_payment') as unknown as Entry[], noun: 'card payment' };
    case 'income': return { items: inc as unknown as Entry[], noun: 'income entry' };
    default: return { items: tx as unknown as Entry[], noun: 'transaction' };
  }
}

// ============================================================
// FILTER MATCHERS
// ============================================================

function matchCategory(q: string, categories: Category[]): string | null {
  const names = categories.map(c => c.name).filter(Boolean).sort((a, b) => b.length - a.length);
  for (const n of names) if (new RegExp(`\\b${escapeRegex(n.toLowerCase())}\\b`).test(q)) return n;
  return null;
}
function matchAccount(q: string, accounts: Account[]): Account | null {
  for (const a of accounts) if (new RegExp(`\\b${escapeRegex(a.name.toLowerCase())}\\b`).test(q)) return a;
  const STOP = ['the', 'and', 'account', 'bank', 'card', 'credit', 'savings', 'saving', 'cash'];
  for (const a of accounts) {
    const words = a.name.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !STOP.includes(w));
    if (words.some(w => new RegExp(`\\b${escapeRegex(w)}\\b`).test(q))) return a;
  }
  return null;
}
function topCategory(expenses: Entry[]): { category: string; amount: number } | null {
  const map = new Map<string, number>();
  expenses.forEach(t => { const c = t.category || 'Uncategorised'; map.set(c, (map.get(c) || 0) + t.amount); });
  let best: string | null = null, max = 0;
  map.forEach((v, k) => { if (v > max) { max = v; best = k; } });
  return best ? { category: best, amount: max } : null;
}
function topCategories(expenses: Entry[], n: number): { category: string; amount: number }[] {
  const map = new Map<string, number>();
  expenses.forEach(t => { const c = t.category || 'Uncategorised'; map.set(c, (map.get(c) || 0) + t.amount); });
  return [...map.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, n);
}

// ============================================================
// BOT DATA + REPLY TYPES
// ============================================================

interface BotData {
  transactions: Transaction[];
  income: Income[];
  accounts: Account[];
  categories: Category[];
  goals: Goal[];
  budgets: Budget[];
  fixedExpenses: FixedExpense[];
  settings: UserSettings | null;
  kpis: DashboardKPIs | null;
  balances: AccountBalance[];
}
interface UserInfo { name?: string; email?: string }
interface BotReply { value?: string; text?: string; entry?: KBEntry }

// ============================================================
// LOCAL ANSWER HANDLERS
// ============================================================

function securityRefusal(q: string): string | null {
  if (/\b(password|passwd|pass ?code|\bpin\b|cvv|otp|secret|api key|token|credential|security question)\b/.test(q))
    return "🔒 I can't access or share passwords, PINs, OTPs, card numbers, or any security credentials — they're never available to me, by design. Please keep those private and never share them with anyone.";
  return null;
}
function answerIdentity(q: string, me: UserInfo): string | null {
  if (/\b(my name|who am i|what's my name|what is my name)\b/.test(q))
    return me.name ? `You're signed in as **${me.name}**.`
      : me.email ? `I don't have your full name, but you're signed in with **${me.email}**.`
        : `I don't have your name on file — you can set it in your profile.`;
  if (/\b(my email|email address|what's my email|what is my email)\b/.test(q))
    return me.email ? `Your account email is **${me.email}**.` : `I don't have your email on file.`;
  return null;
}
function answerEntityCount(q: string, data: BotData, hasDate: boolean): string | null {
  if (!/\b(how many|number of|count of|total number)\b/.test(q)) return null;
  if (/\baccounts?\b/.test(q)) { const n = data.accounts.filter(a => a.is_active).length; return `🏦 You have ${n} active account${n === 1 ? '' : 's'}.`; }
  if (/\bgoals?\b/.test(q)) { const n = data.goals.filter(g => g.is_active).length; return `🎯 You have ${n} active goal${n === 1 ? '' : 's'}.`; }
  if (/\bbudgets?\b/.test(q)) { const n = data.budgets.length; return `📊 You have ${n} budget${n === 1 ? '' : 's'} set.`; }
  if (/\bcategor(y|ies)\b/.test(q)) { const n = data.categories.filter(c => c.is_active).length; return `🏷️ You have ${n} active categor${n === 1 ? 'y' : 'ies'}.`; }
  if (hasDate) return null; // let the date-aware data query handle period counts
  if (/\btransactions?\b/.test(q)) { const n = data.transactions.length; return `🧾 You have ${n} transaction${n === 1 ? '' : 's'} recorded in total.`; }
  if (/\bincome\b/.test(q)) { const n = data.income.length; return `💵 You have ${n} income entr${n === 1 ? 'y' : 'ies'} recorded in total.`; }
  return null;
}
function answerHelp(q: string): string | null {
  const helpSignal = /\b(how (do|to|can) i|how to|where (do|can) i|guide|tutorial|steps to)\b/.test(q);
  for (const h of HELP) {
    if (h.keywords.some(kw => q.includes(kw)) && (helpSignal || q.startsWith('add ') || q.includes('how')))
      return `🧭 **${h.title}**\n\n${h.steps}`;
  }
  return null;
}

// Maps common currency WORDS onto their ISO code so "convert 1000 baht to
// rupees" works as well as "1000 THB to INR". Codes themselves are matched
// separately against CURRENCY_SYMBOLS.
const CURRENCY_WORDS: Record<string, string> = {
  rupee: 'INR', rupees: 'INR', rs: 'INR', inr: 'INR',
  baht: 'THB', thb: 'THB',
  dollar: 'USD', dollars: 'USD', usd: 'USD', buck: 'USD', bucks: 'USD',
  euro: 'EUR', euros: 'EUR', eur: 'EUR',
  pound: 'GBP', pounds: 'GBP', gbp: 'GBP', quid: 'GBP', sterling: 'GBP',
  yen: 'JPY', jpy: 'JPY',
  dirham: 'AED', dirhams: 'AED', aed: 'AED',
};

// Resolve a single currency token (an ISO code or a word like "baht") to its
// upper-cased ISO code, but only if we actually know a symbol for it.
function resolveCurrencyToken(token: string): string | null {
  const t = token.toLowerCase();
  const code = CURRENCY_WORDS[t] ?? t.toUpperCase();
  return CURRENCY_SYMBOLS[code] ? code : null;
}

// Detect a currency *code* asked about (e.g. "how much in THB"). Matches a
// known code that is actually used by one of the user's accounts, so a plain
// word never gets mistaken for a currency. Returns the upper-cased code.
function matchCurrencyCode(q: string, accounts: Account[]): string | null {
  const used = new Set(accounts.map(a => (a.currency || '').toUpperCase()).filter(Boolean));
  for (const code of used) {
    if (CURRENCY_SYMBOLS[code] && new RegExp(`\\b${escapeRegex(code.toLowerCase())}\\b`).test(q)) return code;
  }
  return null;
}

function answerBalance(q: string, data: BotData, fc: (n: number) => string): string {
  const baseCur = data.settings?.currency ?? 'INR';
  const acct = matchAccount(q, data.accounts);
  if (acct) {
    const b = data.balances.find(x => x.account.id === acct.id);
    if (!b) return `I couldn't find that account.`;
    // Show each account in its OWN currency (balances are stored per-account).
    const afc = (n: number) => formatCurrency(n, currencySymbol(acct.currency || baseCur));
    return b.is_credit_card ? `💳 ${acct.name} outstanding: ${afc(b.outstanding ?? 0)} (amount you owe).` : `💰 ${acct.name} balance: ${afc(b.balance)}.`;
  }

  // "how much in THB" — a currency, not an account: sum same-currency accounts.
  const code = matchCurrencyCode(q, data.accounts);
  if (code) {
    const inCur = data.balances.filter(b => b.account.is_active && (b.account.currency || baseCur).toUpperCase() === code);
    const cfc = (n: number) => formatCurrency(n, currencySymbol(code));
    if (!inCur.length) return `You have no active accounts in ${code}.`;
    const lines = inCur.map(b => b.is_credit_card ? `• ${b.account.name}: ${cfc(b.outstanding ?? 0)} owed` : `• ${b.account.name}: ${cfc(b.balance)}`);
    const liquid = inCur.filter(b => !b.is_credit_card).reduce((s, b) => s + b.balance, 0);
    const owed = inCur.filter(b => b.is_credit_card).reduce((s, b) => s + (b.outstanding ?? 0), 0);
    return `💰 Your ${code} accounts:\n${lines.join('\n')}\n\nTotal in ${code}: ${cfc(liquid)}${owed > 0 ? `\nOwed on ${code} cards: ${cfc(owed)}` : ''}`;
  }

  const active = data.balances.filter(b => b.account.is_active);
  if (!active.length) return 'No active accounts found yet.';
  // When accounts span multiple currencies, render each in its own currency
  // and skip a (misleading) cross-currency total.
  const currencies = new Set(active.map(b => (b.account.currency || baseCur).toUpperCase()));
  const multi = currencies.size > 1;
  const balFc = (b: AccountBalance) => formatCurrency(
    b.is_credit_card ? (b.outstanding ?? 0) : b.balance,
    currencySymbol(b.account.currency || baseCur),
  );
  const lines = active.map(b => b.is_credit_card ? `• ${b.account.name}: ${balFc(b)} owed` : `• ${b.account.name}: ${balFc(b)}`);
  if (multi) {
    return `💰 Account balances:\n${lines.join('\n')}\n\n(Accounts span ${currencies.size} currencies — ask "how much in ${[...currencies][0]}" for a per-currency total.)`;
  }
  const liquid = active.filter(b => !b.is_credit_card).reduce((s, b) => s + b.balance, 0);
  const owed = active.filter(b => b.is_credit_card).reduce((s, b) => s + (b.outstanding ?? 0), 0);
  return `💰 Account balances:\n${lines.join('\n')}\n\nTotal cash/savings: ${fc(liquid)}${owed > 0 ? `\nTotal owed on cards: ${fc(owed)}` : ''}`;
}

function topCutTip(data: BotData, fc: (n: number) => string): string {
  const now = new Date();
  const start = fmt(startOfMonth(now)), end = fmt(endOfMonth(now));
  const exp = data.transactions.filter(t => t.type === 'expense' && t.date >= start && t.date <= end) as unknown as Entry[];
  const tc = topCategory(exp);
  return tc ? `\n• Your biggest category this month is ${tc.category} (${fc(tc.amount)}) — trimming it speeds this up` : '';
}

// "where did my money go", "what did I spend the most on", "top spending".
// Lists the top 3-5 expense categories for the period (date in query, else
// this month).
function answerTopSpending(q: string, data: BotData): string | null {
  // Deliberately NOT matching "biggest expense" (singular) — that means the
  // single largest transaction, handled by the existing 'top' data query.
  const signal = /\b(where did (my|the) money go|where('?s| is| has) (my|the) money gone|what did i spend (the )?most on|what.*spend the most|spend the most on|top (spending|categor(y|ies))|biggest (spending|categor(y|ies))|spent the most|most spending)\b/.test(q);
  if (!signal) return null;
  const sym = data.settings?.currency_symbol ?? '₹';
  const fc = (n: number) => formatCurrency(n, sym);
  let range = parseDateRange(q);
  const defaulted = !range;
  if (!range) { const now = new Date(); range = { start: fmt(startOfMonth(now)), end: fmt(endOfMonth(now)), label: 'this month' }; }
  const expenses = data.transactions.filter(t => t.type === 'expense' && t.date >= range!.start && t.date <= range!.end) as unknown as Entry[];
  if (!expenses.length) return `No expenses recorded ${range.label}. 🎉`;
  const top = topCategories(expenses, 5);
  const total = sum(expenses);
  const rows = top.map((c, i) => {
    const pct = total > 0 ? Math.round((c.amount / total) * 100) : 0;
    return `${i + 1}. ${c.category} — ${fc(c.amount)} (${pct}%)`;
  });
  const hint = defaulted ? '\n\n(Defaulted to this month — add a date like "last month" to change it.)' : '';
  return `💸 Where your money went ${range.label} (total ${fc(total)}):\n${rows.join('\n')}${hint}`;
}

// "am I overspending", "how are my budgets". Summarises budget health for the
// current month: how many over / on-track, and the worst category.
function answerBudgetHealth(q: string, data: BotData): string | null {
  const signal = /\b(am i overspending|over ?spending|how are my budgets?|how('?s| is) my budget|budget status|budget health|on (track|budget)|over budget|within budget|am i on budget)\b/.test(q);
  if (!signal) return null;
  const sym = data.settings?.currency_symbol ?? '₹';
  const fc = (n: number) => formatCurrency(n, sym);
  if (!data.budgets.length) return `You haven't set any budgets yet. Add one in **Budget** and I'll track your pace day-by-day.`;
  const now = new Date();
  const statuses = calculateBudgetStatus(data.budgets, data.transactions, data.fixedExpenses, now, now.getMonth() + 1, now.getFullYear());
  const tracked = statuses.filter(s => s.status !== 'grey');
  if (!tracked.length) return `You have budgets set, but none are active for this month yet.`;
  const over = tracked.filter(s => s.status === 'red');
  const near = tracked.filter(s => s.status === 'orange');
  const onTrack = tracked.filter(s => s.status === 'green');
  const lines: string[] = [];
  if (!over.length && !near.length) {
    lines.push(`✅ You're on track — all ${onTrack.length} budgeted categor${onTrack.length === 1 ? 'y is' : 'ies are'} within pace this month.`);
  } else {
    const verdict = over.length ? `⚠️ You're overspending in ${over.length} categor${over.length === 1 ? 'y' : 'ies'}.` : `🟡 ${near.length} categor${near.length === 1 ? 'y is' : 'ies are'} close to the limit.`;
    lines.push(verdict);
    lines.push(`• On track: ${onTrack.length} · Near limit: ${near.length} · Over: ${over.length}`);
    const worst = [...tracked].sort((a, b) => b.overspent - a.overspent)[0];
    if (worst && worst.overspent > 0) {
      lines.push(`• Worst: ${worst.category} — ${fc(worst.actual_till_date)} spent vs ${fc(worst.allowed_till_date)} allowed so far (over by ${fc(worst.overspent)}).`);
    }
  }
  return `📊 Budget check — this month:\n${lines.join('\n')}`;
}

// "net worth", "what am I worth". Cash + savings + investments − CC outstanding.
function answerNetWorth(q: string, data: BotData): string | null {
  if (!/\b(net ?worth|what am i worth|how much am i worth|total wealth)\b/.test(q)) return null;
  const sym = data.settings?.currency_symbol ?? '₹';
  const fc = (n: number) => formatCurrency(n, sym);
  const k = data.kpis;
  // Investments aren't in the KPI totals — sum investment-role accounts here.
  const investTotal = data.balances
    .filter(b => b.account.is_active && !b.is_credit_card && accountRole(b.account) === 'investment')
    .reduce((s, b) => s + b.balance, 0);
  const cash = k?.spendable_balance ?? 0;
  const savings = k?.savings_balance ?? 0;
  const cc = k?.total_cc_outstanding ?? 0;
  const netWorth = cash + savings + investTotal - cc + (k?.cc_credit_balance ?? 0);
  const lines = [
    `💎 Your net worth: **${fc(netWorth)}**`,
    '',
    `• Cash (spendable): ${fc(cash)}`,
    `• Savings: ${fc(savings)}`,
    `• Investments: ${fc(investTotal)}`,
    `• − Credit card owed: ${fc(cc)}`,
  ];
  return lines.join('\n');
}

function answerAffordability(q: string, data: BotData): string | null {
  if (!/\b(afford|can i (buy|get|purchase|take)|should i (buy|get)|do i have enough|enough (money|savings)|want to buy|planning to buy|thinking of buying|save up for)\b/.test(q)) return null;
  const sym = data.settings?.currency_symbol ?? '₹';
  const fc = (n: number) => formatCurrency(n, sym);

  let price = parseAmount(q);
  let itemName = '';
  if (price == null) {
    // Word-boundary match so "Car" goal doesn't match "carnival".
    const hits = (s: string) => new RegExp(`\\b${escapeRegex(s.toLowerCase())}\\b`).test(q);
    const g = data.goals.find(g => hits(g.name) || (g.goal_type ? hits(g.goal_type) : false));
    if (g) { price = g.expected_cost; itemName = g.name; }
  }
  if (price == null) {
    const m = q.match(/\b(?:buy|afford|purchase|get)\s+(?:a|an|the)?\s*([a-z][a-z ]{1,28})/);
    const what = m ? m[1].trim().replace(/\b(for|now|right|soon|this|it)\b.*$/, '').trim() : '';
    return `I can check that! 💭 How much does ${what ? `the ${what}` : 'it'} cost? For example: "can I afford a car for ₹8 lakh?"`;
  }

  const pool = data.balances
    .filter(b => !b.is_credit_card && b.account.is_active && b.account.include_in_goal_savings)
    .reduce((s, b) => s + b.balance, 0);
  // Saving capacity from the last 3 COMPLETED months (true income − expenses),
  // averaged. This is far more stable than the current partial month, which
  // understates expenses (and so overstates capacity) early in the month.
  const now = new Date();
  let sumCap = 0, sumInc = 0, sumExp = 0, monthsWithData = 0;
  for (let i = 1; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const mt = getMonthTotals(data.income, data.transactions, d.getMonth() + 1, d.getFullYear());
    if (mt.income > 0 || mt.expense > 0) { sumCap += mt.trueIncome - mt.expense; sumInc += mt.trueIncome; sumExp += mt.expense; monthsWithData++; }
  }
  const k = data.kpis;
  // Fall back to the current month only for brand-new users with no history.
  const monthlyCapacity = monthsWithData > 0 ? sumCap / monthsWithData : (k ? k.true_income - k.total_expense : 0);
  const avgInc = monthsWithData > 0 ? sumInc / monthsWithData : (k?.true_income ?? 0);
  const avgExp = monthsWithData > 0 ? sumExp / monthsWithData : (k?.total_expense ?? 0);
  const basis = monthsWithData > 0 ? `avg of last ${monthsWithData} month${monthsWithData === 1 ? '' : 's'}` : 'this month so far';
  const label = itemName ? `the ${itemName}` : 'it';

  if (pool >= price) {
    const left = pool - price;
    const tight = left < price * 0.2;
    return `✅ **Yes — you can afford ${label} (${fc(price)}) now.**\n\n• Savings available: ${fc(pool)}\n• Left after buying: ${fc(left)}\n\n${tight ? '⚠️ Heads up: this uses most of your savings — keep an emergency buffer before committing.' : '👍 You\'ll still keep a healthy buffer afterwards.'}\n\n_Not financial advice — based on your recorded numbers._`;
  }

  const gap = price - pool;
  if (monthlyCapacity <= 0) {
    return `❌ **Not yet.** ${cap(label)} costs ${fc(price)}; you have ${fc(pool)} saved (short by ${fc(gap)}).\n\nYour typical monthly spending (${fc(avgExp)}, ${basis}) is at or above your income (${fc(avgInc)}), so you aren't building savings right now.\n\n**How to get there:**\n• Free up some monthly surplus first${topCutTip(data, fc)}\n• Or boost income\n• Even saving ${fc(Math.max(5000, Math.round(price * 0.05)))}/month gets this moving.\n\n_Not financial advice._`;
  }

  const months = Math.ceil(gap / monthlyCapacity);
  const when = format(addMonths(new Date(), months), 'MMMM yyyy');
  const faster = Math.ceil(gap / (monthlyCapacity * 1.5));
  return `🟡 **Not right now — but it's within reach.** ${cap(label)} costs ${fc(price)}; you have ${fc(pool)} (short by ${fc(gap)}).\n\n• Your typical saving capacity: ~${fc(monthlyCapacity)}/month (${basis})\n• At that pace: **~${months} month${months === 1 ? '' : 's'}** → around ${when}\n\n**How to manage it:**\n• Save ${fc(monthlyCapacity)}/month consistently${topCutTip(data, fc)}\n• Push savings to ${fc(Math.round(monthlyCapacity * 1.5))}/month and you'd get there in ~${faster} months\n• If you need it sooner, weigh an EMI against your monthly budget\n\n_Not financial advice — based on your recorded numbers._`;
}

// "show me my last 10 transactions", "recent expenses", "latest income".
// These mean "the N most recent, all-time" — NOT a calendar period.
function answerRecentList(q: string, data: BotData): string | null {
  const recentSignal = /\b(recent|latest|last|past|show me|show all|show my|list|view|see)\b/.test(q);
  const entityWord = /\b(transactions?|expenses?|incomes?|savings?|payments?|entries|deposits?|spends?)\b/.test(q);
  if (!recentSignal || !entityWord) return null;
  const sym = data.settings?.currency_symbol ?? '₹';
  const fc = (n: number) => formatCurrency(n, sym);
  const numMatch = q.match(/\b(\d{1,3})\b/);
  const n = Math.min(50, Math.max(1, numMatch ? parseInt(numMatch[1], 10) : 10));
  const entity = classifyEntity(q);
  const { items, noun } = pickEntity(entity, data.transactions, data.income);
  if (!items.length) return `You have no ${noun}s recorded yet.`;
  const sorted = [...items].sort((a, b) => b.date.localeCompare(a.date)).slice(0, n);
  const rows = sorted.map(t => `• ${t.date} · ${descOf(t) || noun} · ${fc(t.amount)}`);
  return `🧾 Your last ${sorted.length} ${noun}${sorted.length === 1 ? '' : 's'}:\n${rows.join('\n')}\n\nTotal shown: ${fc(sum(sorted))}`;
}

// "my savings", "how much have I saved", "savings this month", "last year
// saving". With NO period → the SAVINGS BALANCE (sum of savings-role account
// balances, each in its own currency, plus a combined total in the base/
// display currency). With a period → the sum of saving-type transactions in
// that period, converted to the base currency.
function answerSavings(q: string, data: BotData): string | null {
  // "savings rate" is a concept (handled by the KB), not a balance question.
  if (/\bsavings? rate\b/.test(q)) return null;
  const range = parseDateRange(q);
  // "savings"/"saved"/"set aside" clearly refer to savings on their own. Bare
  // present-tense "save" ("how much can I save") only counts with a period
  // (e.g. "how much did I save in June"), so it doesn't hijack capacity
  // questions better served elsewhere.
  const nounSignal = /\b(savings?|saved|set aside|put aside)\b/.test(q);
  const verbSignal = range !== null && /\bsave\b/.test(q);
  if (!nounSignal && !verbSignal) return null;
  // If a specific account is named with no period (e.g. "my HDFC savings
  // balance"), let the dedicated balance handler report that one account.
  if (!range && matchAccount(q, data.accounts)) return null;

  const base = data.settings?.currency ?? 'INR';
  const baseSym = currencySymbol(base);
  const rates = data.settings?.exchange_rates;
  const fcBase = (n: number) => formatCurrency(n, baseSym);

  // --- Period flow: how much did I SAVE (saving-type transactions) ---
  if (range) {
    const savings = data.transactions.filter(t => t.type === 'saving' && t.date >= range.start && t.date <= range.end);
    if (!savings.length) return `🏦 You haven't recorded any savings ${range.label}.`;
    const accCur = new Map(data.accounts.map(a => [a.id, (a.currency || base).toUpperCase()]));
    const total = savings.reduce((s, t) => {
      const cur = accCur.get(t.from_account_id ?? t.to_account_id ?? '') ?? base;
      return s + convertAmount(t.amount, cur, base, rates, base);
    }, 0);
    const n = savings.length;
    return `🏦 You saved ${fcBase(total)} ${range.label} across ${n} saving entr${n === 1 ? 'y' : 'ies'}.`;
  }

  // --- Balance flow: how much do I HAVE saved (savings-role accounts) ---
  const savingsAccts = data.balances.filter(b =>
    b.account.is_active && !b.is_credit_card &&
    (accountRole(b.account) === 'savings' || b.account.include_in_goal_savings));
  if (!savingsAccts.length) {
    return `🏦 You don't have any savings accounts set up yet. Mark an account as savings (or "Include in goal savings") in **Settings → Accounts** and it'll show up here.`;
  }
  const lines = savingsAccts.map(b => {
    const sym = currencySymbol(b.account.currency || base);
    return `${b.account.name} ${formatCurrency(b.balance, sym)}`;
  });
  const total = savingsAccts.reduce((s, b) =>
    s + convertAmount(b.balance, (b.account.currency || base).toUpperCase(), base, rates, base), 0);
  return `🏦 Your savings: ${fcBase(total)} total — ${lines.join(', ')}.`;
}

// Currency rates + conversions. Handles:
//   • "exchange rates" / "what are the rates"  → list every known rate.
//   • "convert 1000 thb to inr" / "500 baht in rupees" → compute a conversion.
//   • "thb to inr rate" (pair, no amount) → show the rate both directions.
function answerCurrency(q: string, data: BotData): string | null {
  const base = (data.settings?.currency ?? 'INR').toUpperCase();
  const baseSym = currencySymbol(base);
  const rates = data.settings?.exchange_rates ?? {};

  const wantsRates = /\b(exchange rates?|currency rates?|conversion rates?|forex|what are the rates|fx rates?)\b/.test(q);

  // A readable bidirectional line for a single currency vs the base.
  const rateLine = (code: string): string | null => {
    if (code === base) return null;
    const r = rates[code];
    if (!r) return null;
    const sym = currencySymbol(code);
    const fwd = formatCurrency(r, baseSym); // 1 unit of `code` in base
    const rev = (1 / r).toLocaleString('en-IN', { maximumFractionDigits: 4 });
    return `• 1 ${code} = ${fwd}  (${baseSym}1 = ${sym}${rev})`;
  };

  // --- Conversion: "<amount> <from> to/in <to>" ---
  // Grab the first number, then the two currency tokens around it.
  const amountMatch = q.match(/(\d[\d,]*(?:\.\d+)?)/);
  const tokenRe = /\b([a-z]{3,8})\b/g;
  const tokens: string[] = [];
  let tm: RegExpExecArray | null;
  while ((tm = tokenRe.exec(q)) !== null) {
    const code = resolveCurrencyToken(tm[1]);
    if (code) tokens.push(code);
  }
  const distinct = [...new Set(tokens)];

  if (amountMatch && distinct.length >= 2) {
    const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
    const from = distinct[0], to = distinct[1];
    if (!isNaN(amount)) {
      const haveFrom = from === base || !!rates[from];
      const haveTo = to === base || !!rates[to];
      if (!haveFrom || !haveTo) {
        const missing = !haveFrom ? from : to;
        return `💱 I don't have an exchange rate for ${missing} yet. Add it in **Settings → Currencies & Exchange Rates → Update rates automatically**.`;
      }
      const result = convertAmount(amount, from, to, rates, base);
      const fromSym = currencySymbol(from), toSym = currencySymbol(to);
      // The single-pair rate that explains the maths: 1 `from` in `to`.
      const perUnit = convertAmount(1, from, to, rates, base);
      const perUnitStr = perUnit.toLocaleString('en-IN', { maximumFractionDigits: 4 });
      return `💱 ${fromSym}${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })} = ${formatCurrency(result, toSym)} (at 1 ${from} = ${toSym}${perUnitStr}).`;
    }
  }

  // --- Pair with no amount: "thb to inr", "inr to thb rate" ---
  if (!wantsRates && distinct.length >= 2) {
    const a = distinct[0], b = distinct[1];
    const foreign = a === base ? b : a; // the non-base side
    const line = rateLine(foreign);
    if (line) return `💱 Exchange rate:\n${line}`;
    return `💱 I don't have an exchange rate for ${foreign} yet. Add it in **Settings → Currencies & Exchange Rates → Update rates automatically**.`;
  }

  // --- List all rates ---
  if (wantsRates) {
    // Currencies in use by accounts, plus any extra ones that have a rate set.
    const used = new Set(data.accounts.map(a => (a.currency || base).toUpperCase()).filter(Boolean));
    const codes = new Set<string>([...used, ...Object.keys(rates)]);
    codes.delete(base);
    const lines = [...codes].map(rateLine).filter((l): l is string => l !== null);
    if (!lines.length) {
      return `💱 No exchange rates are set yet. Add them in **Settings → Currencies & Exchange Rates → Update rates automatically** and I'll convert between your currencies.`;
    }
    return `💱 Exchange rates (base ${base}):\n${lines.join('\n')}`;
  }

  return null;
}

function answerDataQuery(q: string, data: BotData): string {
  const sym = data.settings?.currency_symbol ?? '₹';
  const fc = (n: number) => formatCurrency(n, sym);
  const intent = classifyIntent(q);
  const entity = classifyEntity(q);
  if (intent === 'balance') return answerBalance(q, data, fc);

  let range = parseDateRange(q);
  const defaulted = !range;
  if (!range) { const now = new Date(); range = { start: fmt(startOfMonth(now)), end: fmt(endOfMonth(now)), label: 'this month' }; }

  const cat = matchCategory(q, data.categories);
  const acct = matchAccount(q, data.accounts);
  let tx = data.transactions.filter(t => t.date >= range!.start && t.date <= range!.end);
  let inc = data.income.filter(i => i.date >= range!.start && i.date <= range!.end);
  if (cat) { tx = tx.filter(t => eq(t.category, cat)); inc = inc.filter(i => eq(i.category, cat)); }
  if (acct) { tx = tx.filter(t => t.from_account_id === acct.id || t.to_account_id === acct.id); inc = inc.filter(i => i.to_account_id === acct.id); }

  const scopeSuffix = `${cat ? ` · ${cat}` : ''}${acct ? ` · ${acct.name}` : ''}`;
  const scope = `${range.label}${scopeSuffix}`;
  const hint = defaulted ? '\n\n(Defaulted to this month — add a date like "last week" to change it.)' : '';

  if (intent === 'summary') {
    const expenses = tx.filter(t => t.type === 'expense') as unknown as Entry[];
    const savings = tx.filter(t => t.type === 'saving') as unknown as Entry[];
    const ccPays = tx.filter(t => t.type === 'credit_card_payment') as unknown as Entry[];
    const transfers = tx.filter(t => t.type === 'transfer') as unknown as Entry[];
    const incomeE = inc as unknown as Entry[];
    if (!tx.length && !inc.length) return `Nothing recorded ${scope}. 🎉${hint}`;
    const lines: string[] = [`📊 Summary — ${scope}`, ''];
    lines.push(`• ${tx.length} transaction${tx.length === 1 ? '' : 's'}${inc.length ? `, ${inc.length} income entr${inc.length === 1 ? 'y' : 'ies'}` : ''}`);
    if (inc.length) lines.push(`• 💵 Income: ${fc(sum(incomeE))}`);
    lines.push(`• 💸 Spent: ${fc(sum(expenses))} (${expenses.length} expense${expenses.length === 1 ? '' : 's'})`);
    if (savings.length) lines.push(`• 🏦 Saved: ${fc(sum(savings))} (${savings.length})`);
    if (ccPays.length) lines.push(`• 💳 Card payments: ${fc(sum(ccPays))} (${ccPays.length})`);
    if (transfers.length) lines.push(`• 🔄 Transfers: ${fc(sum(transfers))} (${transfers.length})`);
    const tc = topCategory(expenses);
    if (tc) lines.push(`• 🏷️ Top category: ${tc.category} (${fc(tc.amount)})`);
    if (expenses.length) { const big = expenses.reduce((a, b) => (b.amount > a.amount ? b : a)); lines.push(`• 🔝 Biggest: ${descOf(big) || 'expense'} ${fc(big.amount)}`); }
    return lines.join('\n') + hint;
  }

  const { items, noun } = pickEntity(entity, tx, inc);

  if (intent === 'count') {
    if (!items.length) return `No ${noun}s found ${scope}.${hint}`;
    return `🧾 ${items.length} ${noun}${items.length === 1 ? '' : 's'} ${scope}. Total: ${fc(sum(items))}.${hint}`;
  }
  if (intent === 'top') {
    if (!items.length) return `No ${noun}s found ${scope}.${hint}`;
    const max = items.reduce((a, b) => (b.amount > a.amount ? b : a));
    return `🔝 Biggest ${noun} ${scope}: ${fc(max.amount)}${descOf(max) ? ` — ${descOf(max)}` : ''} (${max.date}).${hint}`;
  }
  if (intent === 'average') {
    if (!items.length) return `No ${noun}s found ${scope}.${hint}`;
    const d = daysInRange(range);
    return `📊 ${cap(noun)}s ${scope}: ${fc(sum(items) / items.length)} avg each, ${fc(sum(items) / d)}/day (${items.length} over ${d} day${d === 1 ? '' : 's'}).${hint}`;
  }
  if (intent === 'list') {
    if (!items.length) return `No ${noun}s found ${scope}.${hint}`;
    const rows = [...items].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8).map(t => `• ${t.date} · ${descOf(t) || noun} · ${fc(t.amount)}`);
    const more = items.length > 8 ? `\n…and ${items.length - 8} more` : '';
    return `🧾 ${items.length} ${noun}${items.length === 1 ? '' : 's'} ${scope} (total ${fc(sum(items))}):\n${rows.join('\n')}${more}${hint}`;
  }
  if (!items.length) return `No ${noun}s found ${scope}.${hint}`;
  const emoji = entity === 'income' ? '💵' : entity === 'saving' ? '🏦' : '💸';
  let tail = '';
  if (entity === 'expense' && items.length > 1 && !cat) { const tc = topCategory(items); if (tc) tail = ` Top: ${tc.category} (${fc(tc.amount)}).`; }
  return `${emoji} ${cap(noun)}s ${scope}: ${fc(sum(items))} across ${items.length} ${noun}${items.length === 1 ? '' : 's'}.${tail}${hint}`;
}

function findKB(q: string): KBEntry | null {
  for (const e of KNOWLEDGE_BASE) if (e.keywords.some(kw => q.includes(kw))) return e;
  return null;
}

// A STRONG "explain how this is computed" signal — "how is X calculated",
// "formula for X", "explain X", "definition of X". This clearly wants the
// concept, so it takes priority even over data handlers like net worth.
function isStrongExplainIntent(q: string): boolean {
  return /\b(how is|how are|how does|how do|explain|formula|calculated|definition|define|what does .* mean|meaning of|why is|why does)\b/.test(q);
}

// A BROADER "tell me what this is" signal — "what is X", "tell me about X",
// "the X card", "X card". Checked AFTER the data handlers so a precise
// question ("what is my net worth") still returns the number, while a pure
// concept lookup ("what's savings rate", "the safe to spend card") reaches the
// knowledge base (and, when no KB entry fits, the LLM).
function isExplainIntent(q: string): boolean {
  return isStrongExplainIntent(q)
    || /\b(tell me about|what is|what's)\b/.test(q)
    || /\bcard\b/.test(q);
}

// Strip filler words so a phrase like "explain the safe to spend card"
// reduces to "safe to spend", then fuzzy-match a KB entry whose title or any
// keyword is contained in (or contains) the cleaned query. Falls back to the
// strict keyword match first so existing exact phrasings are unaffected.
const KB_FILLER = new Set([
  'the', 'a', 'an', 'card', 'my', 'me', 'explain', 'what', 'whats', "what's",
  'is', 'are', 'does', 'do', 'mean', 'means', 'meaning', 'of', 'tell', 'about',
  'how', 'show', 'calculated', 'calculate', 'definition', 'define', 'value',
  'this', 'that', 'please', 'pls', 'and', 'for', 'to', 'in', 'on', 'why',
]);
function findKBFuzzy(q: string): KBEntry | null {
  const exact = findKB(q);
  if (exact) return exact;
  const cleaned = q
    .replace(/[?.!,]/g, ' ')
    .split(/\s+/)
    .filter(w => w && !KB_FILLER.has(w))
    .join(' ')
    .trim();
  if (!cleaned) return null;
  for (const e of KNOWLEDGE_BASE) {
    const candidates = [e.title.toLowerCase(), ...e.keywords];
    for (const c of candidates) {
      if (!c) continue;
      // Match either direction: the KB phrase is in the query, or the cleaned
      // query is in the KB phrase (so "savings rate" ⇄ "rate").
      if (cleaned.includes(c) || c.includes(cleaned)) return e;
    }
  }
  return null;
}
function liveValueFor(kb: KBEntry, data: BotData): string | null {
  const k = data.kpis; if (!k) return null;
  const fc = (n: number) => formatCurrency(n, data.settings?.currency_symbol ?? '₹');
  switch (kb.title) {
    case 'Safe to Spend': return `Right now: ${fc(k.safe_to_spend)}`;
    case 'Savings Rate': return `This month: ${k.savings_rate.toFixed(1)}%`;
    case 'True Income': return `This month: ${fc(k.true_income)}`;
    case 'Net Cashflow': return `This month: ${fc(k.net_cashflow)}`;
    case 'Spendable Balance': return `Right now: ${fc(k.spendable_balance)}`;
    case 'Credit Card Outstanding': return `Right now: ${fc(k.total_cc_outstanding)}`;
    default: return null;
  }
}

// What kind of answer the local engine produced:
//   data     — a precise computed answer (counts/sums/balances/savings/
//              affordability/identity/security/currency). Always instant and
//              correct; the caller should NOT ask the LLM.
//   concept  — a knowledge-base explanation. The LLM can phrase it better, so
//              the caller may prefer the LLM when a key is configured.
//   fallback — nothing matched. The caller should try the LLM if available.
type AnswerKind = 'data' | 'concept' | 'fallback';

// Top-level router. Returns a local reply plus a `kind` hint that tells the
// caller whether to keep the local answer (data) or prefer the LLM when one is
// configured (concept / fallback). `confident` stays for backwards-compatible
// callers (true for everything except the bare-capabilities fallback).
function localAnswer(rawQuery: string, data: BotData, me: UserInfo): { reply: BotReply; confident: boolean; kind: AnswerKind } {
  const q = rawQuery.toLowerCase().trim();
  // A synonym-normalised alternate phrasing, tried as a SECOND chance so it
  // never overrides a query the raw matchers already handle.
  const qn = normalizeQuery(q);
  const fcBase = (n: number) => formatCurrency(n, data.settings?.currency_symbol ?? '₹');
  const dataReply = (text: string) => ({ reply: { text }, confident: true, kind: 'data' as const });
  // Soft = a local best-effort answer, but prefer the LLM when one is configured
  // (used for greetings and vague/loosely-matched money questions).
  const softReply = (text: string) => ({ reply: { text }, confident: false, kind: 'fallback' as const });

  const sec = securityRefusal(q); if (sec) return dataReply(sec);
  // "help"/"menu"/"what can you do" → show the capabilities list locally.
  if (/^(help|menu|what can (you|u) do|what do you do)\b/.test(q)) return dataReply(CAPABILITIES);
  // A greeting / small-talk opener → let the LLM converse (falls back to the
  // capabilities text when no key is configured).
  if (/^(hi|hii+|hello+|helo|hey+|yo|sup|namaste|good (morning|afternoon|evening|day)|how('?s| is) it going|how are (you|u)|thanks?|thank you|ok|okay|cool)\b/.test(q)) return softReply(CAPABILITIES);

  const id = answerIdentity(q, me); if (id) return dataReply(id);
  const help = answerHelp(q); if (help) return dataReply(help);
  const afford = answerAffordability(q, data); if (afford) return dataReply(afford);

  // Currency conversion / exchange rates — precise, always local.
  const currency = answerCurrency(q, data) ?? answerCurrency(qn, data); if (currency) return dataReply(currency);

  // Savings (balance or period) — the main fix. Precise, always local.
  const savings = answerSavings(q, data) ?? answerSavings(qn, data); if (savings) return dataReply(savings);

  // STRONG explain ("how is X calculated", "explain X", "formula for X") wins
  // even over data handlers — it clearly wants the concept, not the number.
  if (isStrongExplainIntent(q)) {
    const kb = findKBFuzzy(q) ?? findKBFuzzy(qn);
    if (kb) return { reply: { value: liveValueFor(kb, data) ?? undefined, entry: kb }, confident: true, kind: 'concept' };
  }

  // Smarter, naturally-phrased data intents. These run BEFORE the broader
  // explain branch so a precise question like "what is my net worth" returns
  // the number, not the formula. Their signals are specific enough not to
  // swallow a concept query.
  const worth = answerNetWorth(q, data) ?? answerNetWorth(qn, data); if (worth) return dataReply(worth);
  const budgetHealth = answerBudgetHealth(q, data) ?? answerBudgetHealth(qn, data); if (budgetHealth) return dataReply(budgetHealth);
  const topSpend = answerTopSpending(q, data) ?? answerTopSpending(qn, data); if (topSpend) return dataReply(topSpend);

  // BROADER explain intent ("what is X", "the X card") → knowledge base
  // (fuzzy). A CONCEPT answer, so the caller may prefer the LLM when one is
  // configured.
  if (isExplainIntent(q)) {
    const kb = findKBFuzzy(q) ?? findKBFuzzy(qn);
    if (kb) return { reply: { value: liveValueFor(kb, data) ?? undefined, entry: kb }, confident: true, kind: 'concept' };
  }

  const hasDate = parseDateRange(q) !== null;
  const intent = classifyIntent(q);

  const count = answerEntityCount(q, data, hasDate); if (count) return dataReply(count);
  // Detect the balance intent on either phrasing, but answer from the RAW
  // query so account names (which may contain synonym words) match cleanly.
  if (intent === 'balance' || classifyIntent(qn) === 'balance') return dataReply(answerBalance(q, data, fcBase));
  if (hasDate) return dataReply(answerDataQuery(q, data));

  // "last 10 transactions" / "recent expenses" → N most recent, all-time
  const recent = answerRecentList(q, data) ?? answerRecentList(qn, data); if (recent) return dataReply(recent);

  // A plain concept question that didn't trip the explain trigger (e.g. just
  // "savings rate") — still a KB concept.
  const kb = findKB(q); if (kb) return { reply: { value: liveValueFor(kb, data) ?? undefined, entry: kb }, confident: true, kind: 'concept' };

  // Loose money-word matches with no explicit date are often vague or contain
  // typos (e.g. "my ciggrate expense"). Give a local best-effort answer but
  // prefer the LLM when one is configured (softReply) so it can truly
  // understand the question. Date-scoped queries above stayed precise/local.
  const dataSignals = intent !== 'unknown' || /\b(transaction|transactions|expense|expenses|income|saving|savings|spent|earned|paid)\b/.test(q);
  if (dataSignals) return softReply(answerDataQuery(q, data));

  // Second chance: the normalised phrasing may expose data signals the raw
  // query hid (e.g. "my spendings" → "expense", "earnings" → "income").
  const dataSignalsN = classifyIntent(qn) !== 'unknown' || /\b(transaction|transactions|expense|expenses|income|saving|savings|spent|earned|paid)\b/.test(qn);
  if (dataSignalsN) return softReply(answerDataQuery(qn, data));

  // Nothing matched locally → show the helpful capabilities text. kind is
  // 'fallback' so the optional AI (if configured) gets a chance to answer.
  return { reply: { text: CAPABILITIES }, confident: false, kind: 'fallback' };
}

// ============================================================
// CONTEXT BUILDER for the AI fallback (no credentials)
// ============================================================

function buildContext(data: BotData, me: UserInfo): string {
  const base = (data.settings?.currency ?? 'INR').toUpperCase();
  const sym = currencySymbol(base);
  const fc = (n: number) => formatCurrency(n, sym);
  const rates = data.settings?.exchange_rates ?? {};
  const k = data.kpis;
  const now = new Date();
  const L: string[] = [];

  // --- Identity & currency ---
  L.push(`Today's date: ${fmt(now)}`);
  if (me.name) L.push(`User name: ${me.name}`);
  if (me.email) L.push(`User email: ${me.email}`);
  L.push(`Base currency: ${base} (${sym}) — all amounts below are in ${base} unless a currency code is shown.`);
  L.push(`Display currency: ${base} (${sym})`);
  const rateCodes = new Set<string>([
    ...data.accounts.map(a => (a.currency || base).toUpperCase()),
    ...Object.keys(rates),
  ]);
  rateCodes.delete(base);
  const rateLines = [...rateCodes]
    .filter(c => rates[c])
    .map(c => `1 ${c} = ${fc(rates[c])}`);
  L.push(`Exchange rates: ${rateLines.length ? rateLines.join('; ') : 'none set'}`);

  // --- Period summaries (income / true income / expenses / savings / net) ---
  const periodLine = (label: string, month: number, year: number) => {
    const t = getMonthTotals(data.income, data.transactions, month, year);
    const net = t.income - t.expense - t.savings;
    return `  - ${label}: income ${fc(t.income)}, true income ${fc(t.trueIncome)}, expenses ${fc(t.expense)}, savings ${fc(t.savings)}, net ${fc(net)}`;
  };
  const last = subMonths(now, 1);
  const sumRange = (start: string, end: string) => {
    const inc = data.income.filter(i => i.date >= start && i.date <= end);
    const income = inc.reduce((s, i) => s + i.amount, 0);
    const trueIncome = inc.filter(i => i.include_in_true_income).reduce((s, i) => s + i.amount, 0);
    const expense = data.transactions.filter(t => t.type === 'expense' && t.date >= start && t.date <= end).reduce((s, t) => s + t.amount, 0);
    const savings = data.transactions.filter(t => t.type === 'saving' && t.date >= start && t.date <= end).reduce((s, t) => s + t.amount, 0);
    return { income, trueIncome, expense, savings };
  };
  const yrLine = (label: string, year: number) => {
    const t = sumRange(`${year}-01-01`, `${year}-12-31`);
    const net = t.income - t.expense - t.savings;
    return `  - ${label}: income ${fc(t.income)}, true income ${fc(t.trueIncome)}, expenses ${fc(t.expense)}, savings ${fc(t.savings)}, net ${fc(net)}`;
  };
  L.push('Period summaries:');
  L.push(periodLine('This month', now.getMonth() + 1, now.getFullYear()));
  L.push(periodLine('Last month', last.getMonth() + 1, last.getFullYear()));
  L.push(yrLine('This year', now.getFullYear()));
  L.push(yrLine('Last year', now.getFullYear() - 1));
  {
    const allInc = data.income.reduce((s, i) => s + i.amount, 0);
    const allTrue = data.income.filter(i => i.include_in_true_income).reduce((s, i) => s + i.amount, 0);
    const allExp = data.transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const allSav = data.transactions.filter(t => t.type === 'saving').reduce((s, t) => s + t.amount, 0);
    L.push(`  - All-time: income ${fc(allInc)}, true income ${fc(allTrue)}, expenses ${fc(allExp)}, savings ${fc(allSav)}, net ${fc(allInc - allExp - allSav)}`);
  }

  // --- Top expense categories (this month, this year) ---
  const monthStart = fmt(startOfMonth(now)), monthEnd = fmt(endOfMonth(now));
  const yearStart = fmt(startOfYear(now)), yearEnd = fmt(endOfYear(now));
  const topCatStr = (start: string, end: string) => {
    const exp = data.transactions.filter(t => t.type === 'expense' && t.date >= start && t.date <= end) as unknown as Entry[];
    const top = topCategories(exp, 6);
    return top.length ? top.map(c => `${c.category} ${fc(c.amount)}`).join(', ') : 'none';
  };
  L.push(`Top expense categories this month: ${topCatStr(monthStart, monthEnd)}`);
  L.push(`Top expense categories this year: ${topCatStr(yearStart, yearEnd)}`);

  // --- Live KPIs ---
  if (k) {
    const investTotal = data.balances
      .filter(b => b.account.is_active && !b.is_credit_card && accountRole(b.account) === 'investment')
      .reduce((s, b) => s + b.balance, 0);
    const netWorth = k.spendable_balance + k.savings_balance + investTotal - k.total_cc_outstanding + (k.cc_credit_balance ?? 0);
    L.push(`Live KPIs: safe to spend ${fc(k.safe_to_spend)}, savings rate ${k.savings_rate.toFixed(1)}%, net cashflow ${fc(k.net_cashflow)}, spendable ${fc(k.spendable_balance)}, savings balance ${fc(k.savings_balance)}, CC outstanding ${fc(k.total_cc_outstanding)}, net worth ${fc(netWorth)}.`);
  }

  // --- Accounts (each in its own currency) ---
  const active = data.balances.filter(b => b.account.is_active);
  if (active.length) {
    L.push(`Accounts (${active.length}):`);
    active.forEach(b => {
      const cur = (b.account.currency || base).toUpperCase();
      const accSym = currencySymbol(cur);
      const amt = b.is_credit_card ? `${formatCurrency(b.outstanding ?? 0, accSym)} outstanding` : `${formatCurrency(b.balance, accSym)} balance`;
      L.push(`  - ${b.account.name} (${b.account.account_type}, ${cur}${b.is_credit_card ? ', credit card' : ''}): ${amt}`);
    });
  }
  const pool = active.filter(b => !b.is_credit_card && b.account.include_in_goal_savings).reduce((s, b) => s + b.balance, 0);
  L.push(`Goal savings pool: ${fc(pool)}`);

  // --- Budgets (this month, with actuals & status) ---
  if (data.budgets.length) {
    const statuses = calculateBudgetStatus(data.budgets, data.transactions, data.fixedExpenses, now, now.getMonth() + 1, now.getFullYear());
    if (statuses.length) {
      L.push('Budgets (this month):');
      statuses.forEach(s => L.push(`  - ${s.category}: limit ${fc(s.monthly_budget)}, spent ${fc(s.actual_till_date)}, status ${s.status}`));
    }
  }

  // --- Goals (target, saved, progress) ---
  if (data.goals.length) {
    L.push('Goals:');
    data.goals.filter(g => g.is_active).forEach(g => {
      const saved = g.amount_allocated ?? 0;
      const pct = g.expected_cost > 0 ? Math.min(100, Math.round((saved / g.expected_cost) * 100)) : 100;
      L.push(`  - ${g.name}: target ${fc(g.expected_cost)}, saved/available ${fc(saved)}, ${pct}% funded`);
    });
  }

  // --- Recent transactions ---
  const recent = [...data.transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
  if (recent.length) {
    L.push('Recent 20 transactions:');
    recent.forEach(t => L.push(`  - ${t.date} ${t.type} ${fc(t.amount)} ${t.category ?? ''} ${t.description ?? ''}`.trim()));
  }
  L.push(`Totals: ${data.transactions.length} transactions, ${data.income.length} income entries, ${data.goals.length} goals, ${data.budgets.length} budgets.`);
  return L.join('\n');
}

// ============================================================
// UI
// ============================================================

interface Message { role: 'user' | 'bot'; text?: string; value?: string; entry?: KBEntry; thinking?: boolean }

// Lightweight inline markdown: **bold** and _italic_. Newlines are preserved
// by the parent's whitespace-pre-wrap, so the bot's answers read cleanly
// instead of showing literal ** and _ characters.
function renderRich(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const regex = /(\*\*[^*\n]+\*\*|_[^_\n]+_)/g;
  let last = 0; let m: RegExpExecArray | null; let key = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) nodes.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    else nodes.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    last = regex.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function BotBubble({ msg }: { msg: Message }) {
  return (
    <div className="rounded-xl p-3 text-sm max-w-[92%]" style={{ background: 'var(--bg-subtle, #f1f5f9)', color: 'var(--text-primary)' }}>
      {msg.thinking ? (
        <span className="inline-flex gap-1 py-1">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '300ms' }} />
        </span>
      ) : (
        <>
          {msg.value && <p className="text-base font-bold mb-1 text-blue-600 dark:text-blue-400">{msg.value}</p>}
          {msg.entry ? (
            <>
              <p className="font-semibold mb-1">{msg.entry.title}</p>
              {msg.entry.formula && <code className="block bg-slate-100 dark:bg-slate-800 rounded p-2 text-xs font-mono mt-1 mb-1 whitespace-pre-wrap break-words">{msg.entry.formula}</code>}
              <p className="text-xs leading-relaxed mt-1" style={{ color: 'var(--text-secondary)' }}>{msg.entry.explanation}</p>
              {msg.entry.example && <p className="text-xs mt-2 italic" style={{ color: 'var(--text-muted, #94a3b8)' }}>e.g. {msg.entry.example}</p>}
            </>
          ) : (
            <p className="whitespace-pre-wrap leading-relaxed">{renderRich(msg.text || '')}</p>
          )}
        </>
      )}
    </div>
  );
}

const WELCOME: Message = {
  role: 'bot',
  text: "Hi! I'm your Finance Bot 🤖 — I read your real data.\n\nTry:\n• \"How many transactions last Sunday?\"\n• \"Can I afford a car for ₹8 lakh?\"\n• \"How do I add a transaction?\"\n• \"What's my safe to spend?\"\n\nAsk me anything about your money.",
};

export function FinanceBot() {
  const { accounts, transactions, income, categories, fixedExpenses, goals, budgets, settings } = useAppStore();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [me, setMe] = useState<UserInfo>({});
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null); // null=unknown, false=no key
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null); // draggable FAB position
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);

  // Enable/disable (synced with the Settings toggle, stored locally)
  useEffect(() => {
    setEnabled(localStorage.getItem('mcs_bot_enabled') !== '0');
    const saved = localStorage.getItem('mcs_bot_pos');
    if (saved) {
      try {
        const p = JSON.parse(saved);
        // Clamp in case the window is now smaller than when it was saved,
        // otherwise the button could sit off-screen and be unreachable.
        setPos({
          x: Math.min(Math.max(8, p.x), window.innerWidth - 56 - 8),
          y: Math.min(Math.max(8, p.y), window.innerHeight - 56 - 8),
        });
      } catch { /* ignore */ }
    }
    const onToggle = (e: Event) => { setEnabled((e as CustomEvent).detail !== false); };
    window.addEventListener('mcs-bot-toggle', onToggle as EventListener);
    // Keep the button on-screen if the viewport is resized/rotated.
    const onResize = () => setPos(p => p ? {
      x: Math.min(Math.max(8, p.x), window.innerWidth - 56 - 8),
      y: Math.min(Math.max(8, p.y), window.innerHeight - 56 - 8),
    } : p);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('mcs-bot-toggle', onToggle as EventListener);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const hideBot = () => {
    setOpen(false);
    localStorage.setItem('mcs_bot_enabled', '0');
    window.dispatchEvent(new CustomEvent('mcs-bot-toggle', { detail: false }));
    toast('Assistant hidden. Re-enable it in Settings → Preferences.', { icon: '🤖' });
  };

  // --- Draggable FAB (so it never blocks content, esp. on mobile) ---
  const FAB = 56;
  const clampPos = (x: number, y: number) => ({
    x: Math.min(Math.max(8, x), (typeof window !== 'undefined' ? window.innerWidth : 400) - FAB - 8),
    y: Math.min(Math.max(8, y), (typeof window !== 'undefined' ? window.innerHeight : 800) - FAB - 8),
  });
  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current; if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) d.moved = true;
    if (d.moved) setPos(clampPos(d.ox + dx, d.oy + dy));
  };
  const onPointerUp = () => {
    const d = dragRef.current; dragRef.current = null;
    if (!d) return;
    if (d.moved) { if (pos) localStorage.setItem('mcs_bot_pos', JSON.stringify(pos)); }
    else { setOpen(o => !o); } // a tap (not a drag) toggles the panel
  };

  // Who is signed in (for "what is my name/email")
  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => {
      const u = data.user;
      if (u) setMe({ name: u.user_metadata?.full_name || u.user_metadata?.name, email: u.email ?? undefined });
    }).catch(() => {});
  }, []);

  const balances = useMemo(() => calculateAccountBalances(accounts, income, transactions), [accounts, income, transactions]);
  const kpis = useMemo<DashboardKPIs | null>(() => {
    if (!settings) return null;
    try {
      const now = new Date();
      const filter: DateFilter = { view: 'monthly', month: now.getMonth() + 1, year: now.getFullYear() };
      return calculateDashboardKPIs(accounts, income, transactions, fixedExpenses, filter, settings);
    } catch { return null; }
  }, [accounts, income, transactions, fixedExpenses, settings]);

  const data: BotData = useMemo(
    () => ({ accounts, transactions, income, categories, goals, budgets, fixedExpenses, settings, kpis, balances }),
    [accounts, transactions, income, categories, goals, budgets, fixedExpenses, settings, kpis, balances]
  );

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, open]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 150); }, [open]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: trimmed }]);

    const { reply, kind } = localAnswer(trimmed, data, me);

    // Precise computed answers (counts/sums/balances/savings/affordability/
    // identity/security/currency) are exact and instant — never call the LLM.
    // Concept explanations and unmatched questions go to the LLM when one is
    // configured (aiAvailable true, or unknown/null so we try once); when no
    // key is set (aiAvailable === false) we use the local reply.
    if (kind === 'data' || aiAvailable === false) {
      setMessages(prev => [...prev, { role: 'bot', ...reply }]);
      return;
    }

    // Try the optional AI for concept/open-ended questions.
    setBusy(true);
    setMessages(prev => [...prev, { role: 'bot', thinking: true }]);
    try {
      const res = await fetch('/api/finance-bot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: trimmed, context: buildContext(data, me) }),
      });
      const j = await res.json();
      setMessages(prev => {
        const base = prev.slice(0, -1); // drop the thinking bubble
        if (j.configured && j.answer) return [...base, { role: 'bot', text: j.answer }];
        return [...base, { role: 'bot', ...reply }]; // not configured / error → local capabilities
      });
      setAiAvailable(!!j.configured);
    } catch {
      setMessages(prev => [...prev.slice(0, -1), { role: 'bot', ...reply }]);
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); send(input); } };

  // Disabled from Settings → render nothing at all.
  if (!enabled) return null;

  // FAB position: dragged spot if set, otherwise default bottom-right.
  const fabStyle = pos
    ? { left: pos.x, top: pos.y, right: 'auto' as const, bottom: 'auto' as const }
    : { right: 24, bottom: 24 };

  return (
    <>
      {/* Draggable floating button — z-40 so z-50 modals always cover it */}
      <button
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{ ...fabStyle, touchAction: 'none' }}
        className="fixed z-40 w-14 h-14 rounded-full bg-blue-600 hover:bg-blue-700 active:scale-95 shadow-lg flex items-center justify-center text-white transition-colors duration-200 cursor-grab active:cursor-grabbing"
        title="Finance Bot (drag to move)"
        aria-label="Open Finance Bot"
      >
        {open ? <X size={22} /> : <Bot size={22} />}
      </button>

      {open && (
        <div
          className="fixed z-40 flex flex-col rounded-2xl shadow-2xl border overflow-hidden animate-fade-in-up"
          style={{
            right: 16, bottom: 88,
            width: 'min(400px, calc(100vw - 24px))',
            height: 'min(560px, calc(100dvh - 120px))',
            background: 'var(--bg-surface, #ffffff)', borderColor: 'var(--border-default, #e2e8f0)',
          }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border-default, #e2e8f0)' }}>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                <Sparkles size={16} className="text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Finance Bot</p>
                <p className="text-[10px]" style={{ color: 'var(--text-muted, #94a3b8)' }}>Reads your real data · private</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={hideBot} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors" aria-label="Hide assistant" title="Hide (re-enable in Settings)">
                <EyeOff size={15} style={{ color: 'var(--text-secondary)' }} />
              </button>
              <button onClick={() => setOpen(false)} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors" aria-label="Close">
                <X size={16} style={{ color: 'var(--text-secondary)' }} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {messages.map((msg, i) =>
              msg.role === 'bot' ? (
                <div key={i} className="flex items-end gap-2">
                  <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center flex-shrink-0">
                    <Bot size={12} className="text-blue-600 dark:text-blue-400" />
                  </div>
                  <BotBubble msg={msg} />
                </div>
              ) : (
                <div key={i} className="flex justify-end">
                  <div className="bg-blue-600 text-white rounded-xl p-3 text-sm max-w-[80%] leading-relaxed whitespace-pre-wrap">{msg.text}</div>
                </div>
              )
            )}
            {messages.length === 1 && (
              <div className="flex flex-wrap gap-1.5 pl-8">
                {QUICK_CHIPS.map(chip => (
                  <button key={chip} onClick={() => send(chip)} className="text-xs px-2.5 py-1 rounded-full border hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:border-blue-400 dark:hover:border-blue-500 transition-colors" style={{ borderColor: 'var(--border-default, #e2e8f0)', color: 'var(--text-secondary)' }}>
                    {chip}
                  </button>
                ))}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="px-3 py-3 border-t flex items-center gap-2" style={{ borderColor: 'var(--border-default, #e2e8f0)' }}>
            <input
              ref={inputRef} type="text" value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKey}
              placeholder="Ask anything about your money..."
              className="flex-1 text-sm px-3 py-2 rounded-lg border outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              style={{ background: 'var(--bg-subtle, #f8fafc)', borderColor: 'var(--border-default, #e2e8f0)', color: 'var(--text-primary)' }}
            />
            <button onClick={() => send(input)} disabled={!input.trim() || busy} className="w-9 h-9 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-white transition-colors flex-shrink-0" aria-label="Send">
              <Send size={15} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
