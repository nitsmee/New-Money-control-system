'use client';
import { useState, useRef, useEffect, useMemo } from 'react';
import { Bot, X, Send, Sparkles } from 'lucide-react';
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  subDays, subMonths, subWeeks, subYears, startOfYear, endOfYear,
  getDay, startOfDay, addMonths,
} from 'date-fns';
import { useAppStore } from '@/lib/store/appStore';
import { createClient } from '@/lib/supabase/client';
import {
  calculateAccountBalances, calculateDashboardKPIs, formatCurrency,
} from '@/lib/utils/calculations';
import type {
  Account, Transaction, Income, Category, Goal, Budget,
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
    const target = WEEKDAYS[wd[2]]; const dow = getDay(t); let diff = dow - target; if (diff <= 0) diff += 7;
    const d = subDays(t, diff); return { start: fmt(d), end: fmt(d), label: `${wd[1]} ${cap(wd[2])}` };
  }
  const bareWd = q.match(/\b(?:on\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (bareWd) {
    const target = WEEKDAYS[bareWd[1]]; const dow = getDay(t); let diff = dow - target; if (diff < 0) diff += 7;
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
    const mIdx = MONTHS[mon[1]]; const yr = mon[2] ? +mon[2] : (mIdx > t.getMonth() ? t.getFullYear() - 1 : t.getFullYear());
    const s = new Date(yr, mIdx, 1); return { start: fmt(s), end: fmt(endOfMonth(s)), label: format(s, 'MMMM yyyy') };
  }
  const yrOnly = q.match(/\b(20\d{2})\b/);
  if (yrOnly) { const yr = +yrOnly[1]; return { start: `${yr}-01-01`, end: `${yr}-12-31`, label: String(yr) }; }
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

function answerBalance(q: string, data: BotData, fc: (n: number) => string): string {
  const acct = matchAccount(q, data.accounts);
  if (acct) {
    const b = data.balances.find(x => x.account.id === acct.id);
    if (!b) return `I couldn't find that account.`;
    return b.is_credit_card ? `💳 ${acct.name} outstanding: ${fc(b.outstanding ?? 0)} (amount you owe).` : `💰 ${acct.name} balance: ${fc(b.balance)}.`;
  }
  const active = data.balances.filter(b => b.account.is_active);
  if (!active.length) return 'No active accounts found yet.';
  const lines = active.map(b => b.is_credit_card ? `• ${b.account.name}: ${fc(b.outstanding ?? 0)} owed` : `• ${b.account.name}: ${fc(b.balance)}`);
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

function answerAffordability(q: string, data: BotData): string | null {
  if (!/\b(can i (afford|buy|get|purchase|take)|able to (buy|afford)|should i buy|do i have enough)\b/.test(q)) return null;
  const sym = data.settings?.currency_symbol ?? '₹';
  const fc = (n: number) => formatCurrency(n, sym);

  let price = parseAmount(q);
  let itemName = '';
  if (price == null) {
    const g = data.goals.find(g => q.includes(g.name.toLowerCase()) || (g.goal_type && q.includes(g.goal_type.toLowerCase())));
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
  const k = data.kpis;
  const monthlyCapacity = k ? (k.true_income - k.total_expense) : 0;
  const label = itemName ? `the ${itemName}` : 'it';

  if (pool >= price) {
    const left = pool - price;
    const tight = left < price * 0.2;
    return `✅ **Yes — you can afford ${label} (${fc(price)}) now.**\n\n• Savings available: ${fc(pool)}\n• Left after buying: ${fc(left)}\n\n${tight ? '⚠️ Heads up: this uses most of your savings — keep an emergency buffer before committing.' : '👍 You\'ll still keep a healthy buffer afterwards.'}\n\n_Not financial advice — based on your recorded numbers._`;
  }

  const gap = price - pool;
  if (monthlyCapacity <= 0) {
    return `❌ **Not yet.** ${cap(label)} costs ${fc(price)}; you have ${fc(pool)} saved (short by ${fc(gap)}).\n\nRight now your monthly expenses (${fc(k?.total_expense ?? 0)}) are at or above your income (${fc(k?.true_income ?? 0)}), so you aren't adding to savings.\n\n**How to get there:**\n• Free up some monthly surplus first${topCutTip(data, fc)}\n• Or boost income\n• Even saving ${fc(Math.max(5000, Math.round(price * 0.05)))}/month gets this moving.\n\n_Not financial advice._`;
  }

  const months = Math.ceil(gap / monthlyCapacity);
  const when = format(addMonths(new Date(), months), 'MMMM yyyy');
  const faster = Math.ceil(gap / (monthlyCapacity * 1.5));
  return `🟡 **Not right now — but it's within reach.** ${cap(label)} costs ${fc(price)}; you have ${fc(pool)} (short by ${fc(gap)}).\n\n• Your saving capacity: ~${fc(monthlyCapacity)}/month\n• At that pace: **~${months} month${months === 1 ? '' : 's'}** → around ${when}\n\n**How to manage it:**\n• Save ${fc(monthlyCapacity)}/month consistently${topCutTip(data, fc)}\n• Push savings to ${fc(Math.round(monthlyCapacity * 1.5))}/month and you'd get there in ~${faster} months\n• If you need it sooner, weigh an EMI against your monthly budget\n\n_Not financial advice — based on your recorded numbers._`;
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

// Top-level router. confident=false → caller may try the AI fallback.
function localAnswer(rawQuery: string, data: BotData, me: UserInfo): { reply: BotReply; confident: boolean } {
  const q = rawQuery.toLowerCase().trim();

  const sec = securityRefusal(q); if (sec) return { reply: { text: sec }, confident: true };
  if (/^(hi|hii|hello|hey|yo|help|menu|what can you do|start)\b/.test(q)) return { reply: { text: CAPABILITIES }, confident: true };

  const id = answerIdentity(q, me); if (id) return { reply: { text: id }, confident: true };
  const help = answerHelp(q); if (help) return { reply: { text: help }, confident: true };
  const afford = answerAffordability(q, data); if (afford) return { reply: { text: afford }, confident: true };

  const explainSignal = /\b(how is|how are|how does|how do|explain|formula|calculated|definition|what does .* mean|why is|why does)\b/.test(q);
  if (explainSignal) { const kb = findKB(q); if (kb) return { reply: { value: liveValueFor(kb, data) ?? undefined, entry: kb }, confident: true }; }

  const hasDate = parseDateRange(q) !== null;
  const intent = classifyIntent(q);

  const count = answerEntityCount(q, data, hasDate); if (count) return { reply: { text: count }, confident: true };
  if (intent === 'balance') return { reply: { text: answerBalance(q, data, n => formatCurrency(n, data.settings?.currency_symbol ?? '₹')) }, confident: true };
  if (hasDate) return { reply: { text: answerDataQuery(q, data) }, confident: true };

  const kb = findKB(q); if (kb) return { reply: { value: liveValueFor(kb, data) ?? undefined, entry: kb }, confident: true };

  const dataSignals = intent !== 'unknown' || /\b(transaction|transactions|expense|expenses|income|saving|savings|spent|earned|paid)\b/.test(q);
  if (dataSignals) return { reply: { text: answerDataQuery(q, data) }, confident: true };

  // Nothing matched locally → let the optional AI fallback try.
  return { reply: { text: CAPABILITIES }, confident: false };
}

// ============================================================
// CONTEXT BUILDER for the AI fallback (no credentials)
// ============================================================

function buildContext(data: BotData, me: UserInfo): string {
  const sym = data.settings?.currency_symbol ?? '₹';
  const fc = (n: number) => formatCurrency(n, sym);
  const k = data.kpis;
  const L: string[] = [];
  L.push(`Today: ${fmt(new Date())}`);
  if (me.name) L.push(`User name: ${me.name}`);
  if (me.email) L.push(`User email: ${me.email}`);
  L.push(`Currency: ${data.settings?.currency ?? 'INR'} (${sym})`);
  if (k) L.push(`This month: income ${fc(k.total_income)}, true income ${fc(k.true_income)}, expenses ${fc(k.total_expense)}, savings ${fc(k.total_savings)}, savings rate ${k.savings_rate.toFixed(1)}%, net cashflow ${fc(k.net_cashflow)}, safe to spend ${fc(k.safe_to_spend)}, spendable ${fc(k.spendable_balance)}, CC outstanding ${fc(k.total_cc_outstanding)}.`);
  const active = data.balances.filter(b => b.account.is_active);
  if (active.length) { L.push(`Accounts (${active.length}):`); active.forEach(b => L.push(`  - ${b.account.name} (${b.account.account_type}${b.is_credit_card ? ', credit card' : ''}): ${b.is_credit_card ? `${fc(b.outstanding ?? 0)} owed` : fc(b.balance)}`)); }
  const pool = active.filter(b => !b.is_credit_card && b.account.include_in_goal_savings).reduce((s, b) => s + b.balance, 0);
  L.push(`Goal savings pool: ${fc(pool)}`);
  if (data.budgets.length) L.push(`Budgets: ${data.budgets.map(b => `${b.category} ${fc(b.monthly_budget)}`).join(', ')}`);
  if (data.goals.length) L.push(`Goals: ${data.goals.map(g => `${g.name} target ${fc(g.expected_cost)}`).join(', ')}`);
  const recent = [...data.transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15);
  if (recent.length) { L.push('Recent transactions:'); recent.forEach(t => L.push(`  - ${t.date} ${t.type} ${fc(t.amount)} ${t.category ?? ''} ${t.description ?? ''}`.trim())); }
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
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
    () => ({ accounts, transactions, income, categories, goals, budgets, settings, kpis, balances }),
    [accounts, transactions, income, categories, goals, budgets, settings, kpis, balances]
  );

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, open]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 150); }, [open]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: trimmed }]);

    const { reply, confident } = localAnswer(trimmed, data, me);

    // Confident local answer, or AI known-unavailable → answer locally.
    if (confident || aiAvailable === false) {
      setMessages(prev => [...prev, { role: 'bot', ...reply }]);
      return;
    }

    // Try the optional AI fallback.
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

  return (
    <>
      {/* Floating button — bottom-RIGHT, z-40 so z-50 modals always cover it */}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-blue-600 hover:bg-blue-700 active:scale-95 shadow-lg flex items-center justify-center text-white transition-all duration-200"
        title="Finance Bot"
        aria-label="Open Finance Bot"
      >
        {open ? <X size={22} /> : <Bot size={22} />}
      </button>

      {open && (
        <div
          className="fixed bottom-24 right-6 z-40 flex flex-col rounded-2xl shadow-2xl border overflow-hidden animate-fade-in-up"
          style={{
            width: 400, maxWidth: 'calc(100vw - 3rem)', height: 560, maxHeight: 'calc(100vh - 8rem)',
            background: 'var(--bg-primary, #ffffff)', borderColor: 'var(--border-default, #e2e8f0)',
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
            <button onClick={() => setOpen(false)} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors" aria-label="Close">
              <X size={16} style={{ color: 'var(--text-secondary)' }} />
            </button>
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
