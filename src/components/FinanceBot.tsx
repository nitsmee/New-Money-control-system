'use client';
import { useState, useRef, useEffect, useMemo } from 'react';
import { Bot, X, Send, Sparkles } from 'lucide-react';
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  subDays, subMonths, subWeeks, subYears, startOfYear, endOfYear,
  getDay, startOfDay,
} from 'date-fns';
import { useAppStore } from '@/lib/store/appStore';
import {
  calculateAccountBalances, calculateDashboardKPIs, formatCurrency,
} from '@/lib/utils/calculations';
import type {
  Account, Transaction, Income, Category, UserSettings, DashboardKPIs, DateFilter,
} from '@/types';

// ============================================================
// CONCEPTUAL KNOWLEDGE BASE (the "how is this calculated" answers)
// ============================================================

interface KBEntry {
  keywords: string[];
  title: string;
  formula?: string;
  explanation: string;
  example?: string;
}

const KNOWLEDGE_BASE: KBEntry[] = [
  {
    keywords: ['safe to spend', 'safe_to_spend', 'how much can i spend', 'spend safely'],
    title: 'Safe to Spend',
    formula: 'Spendable Balance − Bank-paid Upcoming Bills − Total CC Outstanding − Safe Spend Buffer',
    explanation:
      'The most conservative estimate of freely-available cash. Starts with your cash accounts, then deducts upcoming bank-paid bills, all credit card outstanding, and your safety buffer. Can be negative — meaning your cash is already spoken for.',
    example: 'Spendable ₹80,000 − Upcoming ₹12,000 − CC ₹8,000 − Buffer ₹5,000 = ₹55,000',
  },
  {
    keywords: ['savings rate', 'savings_rate', 'saving percent', 'saving rate'],
    title: 'Savings Rate',
    formula: 'min(100, (Total Savings ÷ True Income) × 100)',
    explanation:
      'What percentage of your true income you set aside this month. Uses True Income (not total) so gifts and reimbursements don\'t inflate it.',
    example: 'Saved ₹20,000, True Income ₹100,000 → 20%',
  },
  {
    keywords: ['true income', 'true_income', 'real income'],
    title: 'True Income',
    formula: 'Sum of income where "Include in True Income" is on',
    explanation:
      'Only money you genuinely earned — salary, freelance, business. Excludes one-off family money, reimbursements, and gifts, which would otherwise inflate your savings rate.',
    example: 'Salary ₹90,000 + Freelance ₹10,000 (reimbursement ₹3,000 excluded) = ₹100,000',
  },
  {
    keywords: ['net cashflow', 'net_cashflow', 'cashflow', 'cash flow'],
    title: 'Net Cashflow',
    formula: 'Total Income − Total Expenses − Total Savings',
    explanation:
      'What remains after all spending and money moved to savings this month. Positive = money left over; negative = you drew down a balance.',
    example: 'Income ₹100,000 − Expenses ₹60,000 − Savings ₹20,000 = ₹20,000',
  },
  {
    keywords: ['budget status', 'allowed till date', 'daily budget', 'allowed today'],
    title: 'Budget: Allowed Till Date',
    formula: 'Posted Fixed Bills + (Discretionary Daily Rate × Days Elapsed)',
    explanation:
      'Compares actual spend vs what you were allowed up to today. Fixed bills count as lump sums on their due date; only the discretionary part is paced daily. Bar turns red if actual exceeds allowed.',
    example: 'Budget ₹30,000, fixed ₹10,000 → ₹667/day discretionary. Day 15: allowed ₹20,000',
  },
  {
    keywords: ['projected', 'forecast', 'projection', 'end of month'],
    title: 'Projected Month-End',
    formula: 'Posted Fixed Bills + (Discretionary Daily Rate × Days in Month)',
    explanation:
      'Extrapolates your discretionary pace across the full month and adds fixed bills. Answers "if I keep spending like this, where will I land?"',
    example: 'Fixed ₹10,000 + ₹500/day × 30 = ₹25,000',
  },
  {
    keywords: ['how is balance calculated', 'how balance works', 'balance calculation'],
    title: 'Account Balance',
    explanation:
      'Every account replays all transactions: income credits, expenses debit. Positive = money you have. For credit cards the sign flips — positive outstanding means you OWE.',
    example: '₹0 + income ₹100,000 − expense ₹20,000 − transfer ₹10,000 = ₹70,000',
  },
  {
    keywords: ['credit card outstanding', 'how is cc', 'card debt calculation'],
    title: 'Credit Card Outstanding',
    formula: 'Initial + CC Purchases − Bill Payments − Transfers to Card',
    explanation:
      'How much you owe on each card right now. Purchases increase it; bill payments and transfers to the card decrease it. Always the live total, not just this month.',
    example: 'Opening ₹5,000 + ₹8,000 − ₹10,000 = ₹3,000',
  },
  {
    keywords: ['goal progress', 'can i buy', 'progress percent', 'how close am i'],
    title: 'Goal Progress',
    formula: 'min(100, (Available Savings ÷ Expected Cost) × 100)',
    explanation:
      'How much of a goal you\'ve saved. Goals draw from a shared savings pool in priority order; an "Amount Allocated" overrides the pool. 100% = ready to buy.',
    example: 'Cost ₹50,000, available ₹30,000 → 60%',
  },
  {
    keywords: ['month over month', 'mom delta', 'vs last month', 'the arrow', 'what does the arrow'],
    title: 'Month-over-Month Delta',
    formula: 'Current Month Value − Previous Month Value',
    explanation:
      'The ▲/▼ arrows on KPI cards compare this month to last. Green = improvement (more income / less expense), red = worse. The figure is the exact rupee change.',
    example: 'Income ₹90,000 → ₹100,000 = ▲ ₹10,000 (green)',
  },
  {
    keywords: ['spendable', 'cash accounts', 'available cash'],
    title: 'Spendable Balance',
    formula: 'Sum of active cash-type accounts shown on dashboard',
    explanation:
      'Your day-to-day pool: current/checking/bank accounts marked cash-type. Excludes savings, investments, family/shared accounts, and credit cards.',
    example: 'HDFC ₹50,000 + ICICI ₹30,000 = ₹80,000',
  },
  {
    keywords: ['upcoming fixed', 'upcoming bills', 'bills due', 'due this month'],
    title: 'Upcoming Fixed Expenses',
    explanation:
      'Recurring bills due this month not yet posted. Excludes already-posted, not-yet-started, and expired ones. This is what you still need to set aside.',
    example: 'Rent ₹15,000 + Electricity ₹2,000 = ₹17,000',
  },
  {
    keywords: ['payday sweep', 'auto sweep', 'leftover', 'sweep to savings'],
    title: 'Payday Sweep',
    explanation:
      'When salary lands, leftover from the previous month in your salary account is offered to move to savings (if enabled). Keeps old money from inflating Safe to Spend.',
    example: 'Leftover ₹12,000 → auto-moved to Savings on payday',
  },
  {
    keywords: ['auto process', 'auto post', 'automatic', 'auto-process'],
    title: 'Auto-Processing',
    explanation:
      'On dashboard load, due fixed expenses and recurring income that haven\'t been posted yet are auto-created as real entries. Idempotent — never duplicates.',
    example: 'SIP ₹5,000 due on 5th → auto-created if missing, skipped if already there',
  },
  {
    keywords: ['family expense', 'personal expense', 'shared expense'],
    title: 'Family vs Personal Expense',
    explanation:
      'Each expense is family or personal based on the source account. Paid from a family/shared/joint account = family; everything else = personal.',
    example: 'Grocery from Joint Account = Family; Dinner from HDFC = Personal',
  },
  {
    keywords: ['investment', 'net worth', 'sip', 'mutual fund'],
    title: 'Investments & Net Worth',
    formula: 'Net Worth = Cash + Savings + Investments − CC Outstanding',
    explanation:
      'Investment accounts are excluded from Spendable and Savings — they only count toward Net Worth. Keeps daily spending figures clean.',
    example: 'Cash ₹80k + Savings ₹120k + Invest ₹300k − CC ₹8k = ₹492k net worth',
  },
];

const FALLBACK_TEXT =
  "I can answer two kinds of questions:\n\n📊 **About your data** — try:\n• \"How many transactions last Sunday?\"\n• \"How much did I spend this month?\"\n• \"Summary of last week\"\n• \"Biggest expense in June\"\n• \"Balance of all accounts\"\n• \"How much on Food this month?\"\n\n💡 **About calculations** — try:\n• \"What's my safe to spend?\"\n• \"Savings rate?\"\n• \"How is balance calculated?\"";

const QUICK_CHIPS = [
  'Summary of this month',
  'How much did I spend this month?',
  'Biggest expense this month',
  "What's my safe to spend?",
  'Balance of all accounts',
];

// ============================================================
// LIGHTWEIGHT ENTRY SHAPE shared by Transaction + Income
// ============================================================

interface Entry {
  amount: number;
  date: string;
  description?: string | null;
  category?: string | null;
  source?: string | null;
  type?: string;
}

const sum = (items: Entry[]) => items.reduce((s, x) => s + (x.amount || 0), 0);
const descOf = (e: Entry) => e.description || e.category || e.source || '';
const eq = (a: string | null | undefined, b: string) => (a || '').toLowerCase() === b.toLowerCase();
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ============================================================
// DATE RANGE PARSER — the heart of the data engine
// ============================================================

interface DateRange { start: string; end: string; label: string; }

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, thursday: 4, thu: 4, thurs: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6,
};

const MONTHS: Record<string, number> = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
  may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7,
  september: 8, sep: 8, sept: 8, october: 9, oct: 9,
  november: 10, nov: 10, december: 11, dec: 11,
};

const fmt = (d: Date) => format(d, 'yyyy-MM-dd');

function parseDateRange(q: string, today = new Date()): DateRange | null {
  const t = startOfDay(today);

  if (/\btoday\b/.test(q)) return { start: fmt(t), end: fmt(t), label: 'today' };
  if (/\byesterday\b/.test(q)) { const d = subDays(t, 1); return { start: fmt(d), end: fmt(d), label: 'yesterday' }; }

  const nDays = q.match(/\b(?:last|past|previous)\s+(\d+)\s+days?\b/);
  if (nDays) { const n = +nDays[1]; return { start: fmt(subDays(t, n - 1)), end: fmt(t), label: `last ${n} days` }; }

  if (/\blast weekend\b/.test(q)) {
    const dow = getDay(t);
    const lastSun = subDays(t, dow === 0 ? 7 : dow);
    const lastSat = subDays(lastSun, 1);
    return { start: fmt(lastSat), end: fmt(lastSun), label: 'last weekend' };
  }

  // "last/this/previous <weekday>"
  const wd = q.match(/\b(last|this|previous|past)\s+(sunday|sun|monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thurs|friday|fri|saturday|sat)\b/);
  if (wd) {
    const target = WEEKDAYS[wd[2]];
    const dow = getDay(t);
    let diff = dow - target;
    if (diff <= 0) diff += 7; // most recent past occurrence (never today)
    const d = subDays(t, diff);
    return { start: fmt(d), end: fmt(d), label: `${wd[1]} ${cap(wd[2])}` };
  }

  // bare weekday: "on sunday" / "sunday"
  const bareWd = q.match(/\b(?:on\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (bareWd) {
    const target = WEEKDAYS[bareWd[1]];
    const dow = getDay(t);
    let diff = dow - target;
    if (diff < 0) diff += 7; // diff 0 = today is that day → use today
    const d = subDays(t, diff);
    return { start: fmt(d), end: fmt(d), label: cap(bareWd[1]) + (diff === 0 ? ' (today)' : '') };
  }

  if (/\bthis week\b/.test(q)) {
    return { start: fmt(startOfWeek(t, { weekStartsOn: 1 })), end: fmt(endOfWeek(t, { weekStartsOn: 1 })), label: 'this week' };
  }
  if (/\b(last|previous|past) week\b/.test(q)) {
    const w = subWeeks(t, 1);
    return { start: fmt(startOfWeek(w, { weekStartsOn: 1 })), end: fmt(endOfWeek(w, { weekStartsOn: 1 })), label: 'last week' };
  }

  if (/\bthis month\b/.test(q)) return { start: fmt(startOfMonth(t)), end: fmt(endOfMonth(t)), label: 'this month' };
  if (/\b(last|previous|past) month\b/.test(q)) { const d = subMonths(t, 1); return { start: fmt(startOfMonth(d)), end: fmt(endOfMonth(d)), label: 'last month' }; }

  if (/\bthis year\b/.test(q)) return { start: fmt(startOfYear(t)), end: fmt(endOfYear(t)), label: 'this year' };
  if (/\b(last|previous|past) year\b/.test(q)) { const d = subYears(t, 1); return { start: fmt(startOfYear(d)), end: fmt(endOfYear(d)), label: 'last year' }; }

  // named month, optional year
  const mon = q.match(/\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\b\.?\s*(\d{4})?/);
  if (mon) {
    const mIdx = MONTHS[mon[1]];
    const yr = mon[2] ? +mon[2] : (mIdx > t.getMonth() ? t.getFullYear() - 1 : t.getFullYear());
    const s = new Date(yr, mIdx, 1);
    return { start: fmt(s), end: fmt(endOfMonth(s)), label: format(s, 'MMMM yyyy') };
  }

  const yrOnly = q.match(/\b(20\d{2})\b/);
  if (yrOnly) { const yr = +yrOnly[1]; return { start: `${yr}-01-01`, end: `${yr}-12-31`, label: String(yr) }; }

  return null;
}

const daysInRange = (r: DateRange) =>
  Math.round((new Date(r.end).getTime() - new Date(r.start).getTime()) / 86400000) + 1;

// ============================================================
// INTENT + ENTITY CLASSIFICATION
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
  if (/\b(cc payment|card payment|credit card payment|bill payment|paid the card)\b/.test(q)) return 'cc_payment';
  if (/\b(income|earned|earning|got paid|received|salary credited)\b/.test(q)) return 'income';
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
// FILTER MATCHERS (category / account)
// ============================================================

function matchCategory(q: string, categories: Category[]): string | null {
  const names = categories.map(c => c.name).filter(Boolean).sort((a, b) => b.length - a.length);
  for (const n of names) {
    if (new RegExp(`\\b${escapeRegex(n.toLowerCase())}\\b`).test(q)) return n;
  }
  return null;
}

function matchAccount(q: string, accounts: Account[]): Account | null {
  for (const a of accounts) {
    if (new RegExp(`\\b${escapeRegex(a.name.toLowerCase())}\\b`).test(q)) return a;
  }
  const STOP = ['the', 'and', 'account', 'bank', 'card', 'credit', 'savings', 'saving', 'cash'];
  for (const a of accounts) {
    const words = a.name.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !STOP.includes(w));
    if (words.some(w => new RegExp(`\\b${escapeRegex(w)}\\b`).test(q))) return a;
  }
  return null;
}

function topCategory(expenses: Entry[]): { category: string; amount: number } | null {
  const map = new Map<string, number>();
  expenses.forEach(t => {
    const c = t.category || 'Uncategorised';
    map.set(c, (map.get(c) || 0) + t.amount);
  });
  let best: string | null = null, max = 0;
  map.forEach((v, k) => { if (v > max) { max = v; best = k; } });
  return best ? { category: best, amount: max } : null;
}

// ============================================================
// DATA QUERY EXECUTOR
// ============================================================

interface BotData {
  transactions: Transaction[];
  income: Income[];
  accounts: Account[];
  categories: Category[];
  settings: UserSettings | null;
  kpis: DashboardKPIs | null;
}

function answerBalance(q: string, data: BotData, fc: (n: number) => string): string {
  const balances = calculateAccountBalances(data.accounts, data.income, data.transactions);
  const acct = matchAccount(q, data.accounts);
  if (acct) {
    const b = balances.find(x => x.account.id === acct.id);
    if (!b) return `I couldn't find that account.`;
    if (b.is_credit_card) return `💳 ${acct.name} outstanding: ${fc(b.outstanding ?? 0)} (amount you owe).`;
    return `💰 ${acct.name} balance: ${fc(b.balance)}.`;
  }
  const active = balances.filter(b => b.account.is_active);
  if (active.length === 0) return 'No active accounts found yet.';
  const lines = active.map(b =>
    b.is_credit_card ? `• ${b.account.name}: ${fc(b.outstanding ?? 0)} owed` : `• ${b.account.name}: ${fc(b.balance)}`
  );
  const liquid = active.filter(b => !b.is_credit_card).reduce((s, b) => s + b.balance, 0);
  const owed = active.filter(b => b.is_credit_card).reduce((s, b) => s + (b.outstanding ?? 0), 0);
  return `💰 Account balances:\n${lines.join('\n')}\n\nTotal cash/savings: ${fc(liquid)}${owed > 0 ? `\nTotal owed on cards: ${fc(owed)}` : ''}`;
}

function buildSummary(tx: Transaction[], inc: Income[], range: DateRange, fc: (n: number) => string, scopeSuffix: string): string {
  const expenses = tx.filter(t => t.type === 'expense') as unknown as Entry[];
  const savings = tx.filter(t => t.type === 'saving') as unknown as Entry[];
  const ccPays = tx.filter(t => t.type === 'credit_card_payment') as unknown as Entry[];
  const transfers = tx.filter(t => t.type === 'transfer') as unknown as Entry[];
  const incomeE = inc as unknown as Entry[];

  const scope = `${range.label}${scopeSuffix}`;
  if (tx.length === 0 && inc.length === 0) return `Nothing recorded ${scope}. 🎉`;

  const lines: string[] = [`📊 Summary — ${scope}`, ''];
  lines.push(`• ${tx.length} transaction${tx.length === 1 ? '' : 's'}${inc.length ? `, ${inc.length} income entr${inc.length === 1 ? 'y' : 'ies'}` : ''}`);
  if (inc.length) lines.push(`• 💵 Income: ${fc(sum(incomeE))}`);
  lines.push(`• 💸 Spent: ${fc(sum(expenses))} (${expenses.length} expense${expenses.length === 1 ? '' : 's'})`);
  if (savings.length) lines.push(`• 🏦 Saved: ${fc(sum(savings))} (${savings.length})`);
  if (ccPays.length) lines.push(`• 💳 Card payments: ${fc(sum(ccPays))} (${ccPays.length})`);
  if (transfers.length) lines.push(`• 🔄 Transfers: ${fc(sum(transfers))} (${transfers.length})`);
  const tc = topCategory(expenses);
  if (tc) lines.push(`• 🏷️ Top category: ${tc.category} (${fc(tc.amount)})`);
  if (expenses.length) {
    const big = expenses.reduce((a, b) => (b.amount > a.amount ? b : a));
    lines.push(`• 🔝 Biggest: ${descOf(big) || 'expense'} ${fc(big.amount)}`);
  }
  return lines.join('\n');
}

function answerDataQuery(q: string, data: BotData): string {
  const sym = data.settings?.currency_symbol ?? '₹';
  const fc = (n: number) => formatCurrency(n, sym);
  const intent = classifyIntent(q);
  const entity = classifyEntity(q);

  if (intent === 'balance') return answerBalance(q, data, fc);

  let range = parseDateRange(q);
  const defaulted = !range;
  if (!range) {
    const now = new Date();
    range = { start: fmt(startOfMonth(now)), end: fmt(endOfMonth(now)), label: 'this month' };
  }

  const cat = matchCategory(q, data.categories);
  const acct = matchAccount(q, data.accounts);

  let tx = data.transactions.filter(t => t.date >= range!.start && t.date <= range!.end);
  let inc = data.income.filter(i => i.date >= range!.start && i.date <= range!.end);
  if (cat) { tx = tx.filter(t => eq(t.category, cat)); inc = inc.filter(i => eq(i.category, cat)); }
  if (acct) {
    tx = tx.filter(t => t.from_account_id === acct.id || t.to_account_id === acct.id);
    inc = inc.filter(i => i.to_account_id === acct.id);
  }

  const scopeSuffix = `${cat ? ` · ${cat}` : ''}${acct ? ` · ${acct.name}` : ''}`;
  const scope = `${range.label}${scopeSuffix}`;
  const hint = defaulted ? '\n\n(Defaulted to this month — add a date like "last week" to change it.)' : '';

  if (intent === 'summary') return buildSummary(tx, inc, range, fc, scopeSuffix) + hint;

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
    const sorted = [...items].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
    const rows = sorted.map(t => `• ${t.date} · ${descOf(t) || noun} · ${fc(t.amount)}`);
    const more = items.length > 8 ? `\n…and ${items.length - 8} more` : '';
    return `🧾 ${items.length} ${noun}${items.length === 1 ? '' : 's'} ${scope} (total ${fc(sum(items))}):\n${rows.join('\n')}${more}${hint}`;
  }

  // default: sum
  if (!items.length) return `No ${noun}s found ${scope}.${hint}`;
  const emoji = entity === 'income' ? '💵' : entity === 'saving' ? '🏦' : '💸';
  let tail = '';
  if (entity === 'expense' && items.length > 1) {
    const tc = topCategory(items);
    if (tc && !cat) tail = ` Top: ${tc.category} (${fc(tc.amount)}).`;
  }
  return `${emoji} ${cap(noun)}s ${scope}: ${fc(sum(items))} across ${items.length} ${noun}${items.length === 1 ? '' : 's'}.${tail}${hint}`;
}

// ============================================================
// CONCEPT MATCHING + LIVE KPI VALUES
// ============================================================

function findKB(q: string): KBEntry | null {
  for (const e of KNOWLEDGE_BASE) {
    if (e.keywords.some(kw => q.includes(kw))) return e;
  }
  return null;
}

function liveValueFor(kb: KBEntry, data: BotData): string | null {
  const k = data.kpis;
  if (!k) return null;
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

// ============================================================
// TOP-LEVEL ANSWER ROUTER
// ============================================================

interface BotReply { value?: string; text?: string; entry?: KBEntry; }

function answer(rawQuery: string, data: BotData): BotReply {
  const q = rawQuery.toLowerCase().trim();
  const hasDate = parseDateRange(q) !== null;
  const intent = classifyIntent(q);
  const explainSignal = /\b(how is|how are|how does|how do|explain|formula|calculated|definition|what does .* mean|why is|why does)\b/.test(q);

  // 1. Explicit "explain / how is X calculated" → conceptual answer
  if (explainSignal) {
    const kb = findKB(q);
    if (kb) return { value: liveValueFor(kb, data) ?? undefined, entry: kb };
  }

  // 2. Balance questions (the live number)
  if (intent === 'balance') return { text: answerBalance(q, data, n => formatCurrency(n, data.settings?.currency_symbol ?? '₹')) };

  // 3. Anything with a date is a data query about that period
  if (hasDate) return { text: answerDataQuery(q, data) };

  // 4. KPI / concept phrase with no date → concept + live value
  const kb = findKB(q);
  if (kb) return { value: liveValueFor(kb, data) ?? undefined, entry: kb };

  // 5. Data signals (count/list/sum/top/avg/summary or an entity word) → data query, default this month
  const dataSignals = intent !== 'unknown' || /\b(transaction|transactions|expense|expenses|income|saving|savings|spent|earned|paid)\b/.test(q);
  if (dataSignals) return { text: answerDataQuery(q, data) };

  // 6. Nothing matched
  return { text: FALLBACK_TEXT };
}

// ============================================================
// UI
// ============================================================

interface Message { role: 'user' | 'bot'; text?: string; value?: string; entry?: KBEntry; }

function BotBubble({ msg }: { msg: Message }) {
  return (
    <div className="rounded-xl p-3 text-sm max-w-[92%]" style={{ background: 'var(--bg-subtle, #f1f5f9)', color: 'var(--text-primary)' }}>
      {msg.value && (
        <p className="text-base font-bold mb-1 text-blue-600 dark:text-blue-400">{msg.value}</p>
      )}
      {msg.entry ? (
        <>
          <p className="font-semibold mb-1">{msg.entry.title}</p>
          {msg.entry.formula && (
            <code className="block bg-slate-100 dark:bg-slate-800 rounded p-2 text-xs font-mono mt-1 mb-1 whitespace-pre-wrap break-words">
              {msg.entry.formula}
            </code>
          )}
          <p className="text-xs leading-relaxed mt-1" style={{ color: 'var(--text-secondary)' }}>{msg.entry.explanation}</p>
          {msg.entry.example && (
            <p className="text-xs mt-2 italic" style={{ color: 'var(--text-muted, #94a3b8)' }}>e.g. {msg.entry.example}</p>
          )}
        </>
      ) : (
        <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
      )}
    </div>
  );
}

const WELCOME: Message = {
  role: 'bot',
  text:
    "Hi! I'm your Finance Bot 🤖 — and I can read your real data.\n\nAsk me things like:\n• \"How many transactions last Sunday?\"\n• \"Summary of this month\"\n• \"Biggest expense in June\"\n• \"What's my safe to spend?\"\n\nGo ahead, ask me anything.",
};

export function FinanceBot() {
  const { accounts, transactions, income, categories, fixedExpenses, settings } = useAppStore();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Live KPIs for the current month (powers "what's my safe to spend" style answers)
  const kpis = useMemo<DashboardKPIs | null>(() => {
    if (!settings) return null;
    try {
      const now = new Date();
      const filter: DateFilter = { view: 'monthly', month: now.getMonth() + 1, year: now.getFullYear() };
      return calculateDashboardKPIs(accounts, income, transactions, fixedExpenses, filter, settings);
    } catch {
      return null;
    }
  }, [accounts, income, transactions, fixedExpenses, settings]);

  const data: BotData = useMemo(
    () => ({ accounts, transactions, income, categories, settings, kpis }),
    [accounts, transactions, income, categories, settings, kpis]
  );

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, open]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 150); }, [open]);

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const reply = answer(trimmed, data);
    setMessages(prev => [...prev, { role: 'user', text: trimmed }, { role: 'bot', ...reply }]);
    setInput('');
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); send(input); }
  };

  return (
    <>
      {/* Floating button — bottom-RIGHT */}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-blue-600 hover:bg-blue-700 active:scale-95 shadow-lg flex items-center justify-center text-white transition-all duration-200"
        title="Finance Bot"
        aria-label="Open Finance Bot"
      >
        {open ? <X size={22} /> : <Bot size={22} />}
      </button>

      {/* Chat panel — bottom-RIGHT */}
      {open && (
        <div
          className="fixed bottom-24 right-6 z-50 flex flex-col rounded-2xl shadow-2xl border overflow-hidden animate-fade-in-up"
          style={{
            width: 400,
            maxWidth: 'calc(100vw - 3rem)',
            height: 560,
            maxHeight: 'calc(100vh - 8rem)',
            background: 'var(--bg-primary, #ffffff)',
            borderColor: 'var(--border-default, #e2e8f0)',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border-default, #e2e8f0)' }}>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                <Sparkles size={16} className="text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Finance Bot</p>
                <p className="text-[10px]" style={{ color: 'var(--text-muted, #94a3b8)' }}>Reads your real data · fully private</p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              aria-label="Close"
            >
              <X size={16} style={{ color: 'var(--text-secondary)' }} />
            </button>
          </div>

          {/* Messages */}
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
                  <button
                    key={chip}
                    onClick={() => send(chip)}
                    className="text-xs px-2.5 py-1 rounded-full border hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
                    style={{ borderColor: 'var(--border-default, #e2e8f0)', color: 'var(--text-secondary)' }}
                  >
                    {chip}
                  </button>
                ))}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="px-3 py-3 border-t flex items-center gap-2" style={{ borderColor: 'var(--border-default, #e2e8f0)' }}>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder="Ask anything about your money..."
              className="flex-1 text-sm px-3 py-2 rounded-lg border outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              style={{ background: 'var(--bg-subtle, #f8fafc)', borderColor: 'var(--border-default, #e2e8f0)', color: 'var(--text-primary)' }}
            />
            <button
              onClick={() => send(input)}
              disabled={!input.trim()}
              className="w-9 h-9 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-white transition-colors flex-shrink-0"
              aria-label="Send"
            >
              <Send size={15} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
