'use client';
import { useMemo, useState, useEffect, useRef } from 'react';
import { useAppStore } from '@/lib/store/appStore';
import {
  calculateAccountBalances, calculateDashboardKPIs, calculateBudgetStatus,
  buildMonthlyTrends, getCategorySpend, generateAlerts, formatCurrency, formatDate, accountRole, safeDueDate,
  currencySymbol, normalizeAmounts, convertAmount, YEAR_OPTIONS
} from '@/lib/utils/calculations';
import { useDisplayCurrency } from '@/lib/useDisplayCurrency';
import { CurrencySelect } from '@/components/CurrencySelect';
import { runAutoProcess } from '@/lib/utils/autoProcess';
import { runAutoProcessIncome } from '@/lib/utils/autoProcessIncome';
import { createClient } from '@/lib/supabase/client';
import toast from 'react-hot-toast';
import {
  AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { Wallet, CreditCard, AlertTriangle, Info, X, ArrowRight, ArrowDownToLine, CalendarRange, PiggyBank, TrendingUp, Landmark, Banknote, Percent } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { format, startOfMonth, endOfMonth, subMonths, startOfYear, endOfYear, subYears } from 'date-fns';
import Link from 'next/link';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Shared year list for the selector — runs through 2060.
const YEARS = YEAR_OPTIONS;

// Quick date-range presets for the dashboard period control. "This Month" and
// "Last Month" stay MONTHLY (so month-bound widgets + MoM chips keep working);
// the range presets and "Custom" drive a custom from/to window.
const DATE_PRESETS = ['This Month', 'Last Month', 'Last 3 Months', 'This Year', 'Last Year', 'Custom'] as const;
type DatePreset = typeof DATE_PRESETS[number];
const MONTHLY_PRESETS: DatePreset[] = ['This Month', 'Last Month'];

// Subtle accent icon + tint per KPI card (visual polish — purely decorative).
const CARD_ACCENT: Record<string, { icon: LucideIcon; color: string }> = {
  'Safe to spend': { icon: Banknote, color: '#10b981' },
  'Spendable': { icon: Wallet, color: '#3b82f6' },
  'Savings': { icon: PiggyBank, color: '#6366f1' },
  'Investments': { icon: TrendingUp, color: '#8b5cf6' },
  'CC outstanding': { icon: CreditCard, color: '#ef4444' },
  'Net cashflow': { icon: ArrowRight, color: '#0ea5e9' },
  'Income this month': { icon: Landmark, color: '#22c55e' },
  'Upcoming fixed': { icon: CalendarRange, color: '#f59e0b' },
  'Ready to sweep': { icon: ArrowDownToLine, color: '#3b82f6' },
  'Swept to savings': { icon: ArrowDownToLine, color: '#3b82f6' },
};

// Smooth count-up for the headline numbers.
function useCountUp(target: number, duration = 650) {
  const [val, setVal] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;
    let raf = 0; const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(from + (target - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

function Amount({ value, sym, className }: { value: number; sym: string; className?: string }) {
  const v = useCountUp(value);
  return <span className={className}>{formatCurrency(Math.round(v), sym)}</span>;
}

interface DetailRow { label: string; amount: number; sign?: '+' | '-'; }
interface DetailData {
  title: string;
  value: number;
  tone: 'pos' | 'neg' | 'plain';
  blurb: string;
  rows?: DetailRow[];
  totalLabel?: string;
  listTitle?: string;
  list?: { label: string; amount: number; muted?: boolean }[];
  link?: { href: string; label: string };
}

let dashboardAutoRan = false;
let incomeAutoRan = false;

// Honors each account's "Show on Dashboard" toggle (Phase 4) — anything not
// explicitly turned off still appears. Module-scoped so it's a stable reference
// (no hook dependency churn) and shared by every balance bucket below.
const shown = (b: { account: { is_active: boolean; include_in_dashboard?: boolean } }) =>
  b.account.is_active && b.account.include_in_dashboard !== false;

export default function DashboardPage() {
  const { accounts, income, transactions, fixedExpenses, budgets, goals, categories, settings, dateFilter, setDateFilter, isLoading, recurringIncome } = useAppStore();

  const now = new Date();
  const fmt = (d: Date) => format(d, 'yyyy-MM-dd');
  const [selMonth, setSelMonth] = useState(dateFilter.month ?? now.getMonth() + 1);
  const [selYear, setSelYear] = useState(dateFilter.year ?? now.getFullYear());
  const [detail, setDetail] = useState<DetailData | null>(null);

  // ---- Flexible period selector ----
  // The dashboard can show ANY time period. Two modes:
  //  • MONTHLY (This Month / Last Month) — keeps the classic month-bound view:
  //    sets selMonth/selYear, uses a { view:'monthly' } filter, and the
  //    month-bound widgets + MoM chips behave exactly as before.
  //  • CUSTOM/RANGE (Last 3 Months / This/Last Year / Custom) — drives a
  //    { view:'custom', start_date, end_date } filter for the period totals and
  //    the category-spend pie; month-bound widgets fall back to the real "now".
  const [datePreset, setDatePreset] = useState<DatePreset>('This Month');
  const [fromDate, setFromDate] = useState(() => fmt(startOfMonth(now)));
  const [toDate, setToDate] = useState(() => fmt(endOfMonth(now)));
  const isMonthlyMode = MONTHLY_PRESETS.includes(datePreset);

  // Apply a preset → resolves the from/to window. For monthly presets we also
  // pin selMonth/selYear (and the persisted dateFilter) to that month so the
  // existing month-bound widgets follow the selection.
  const applyDatePreset = (p: DatePreset) => {
    setDatePreset(p);
    const today = new Date();
    if (p === 'This Month') {
      const m = today.getMonth() + 1, y = today.getFullYear();
      setSelMonth(m); setSelYear(y);
      setFromDate(fmt(startOfMonth(today))); setToDate(fmt(endOfMonth(today)));
      setDateFilter({ ...dateFilter, view: 'monthly', month: m, year: y });
    } else if (p === 'Last Month') {
      const d = subMonths(today, 1);
      const m = d.getMonth() + 1, y = d.getFullYear();
      setSelMonth(m); setSelYear(y);
      setFromDate(fmt(startOfMonth(d))); setToDate(fmt(endOfMonth(d)));
      setDateFilter({ ...dateFilter, view: 'monthly', month: m, year: y });
    } else if (p === 'Last 3 Months') {
      setFromDate(fmt(startOfMonth(subMonths(today, 2)))); setToDate(fmt(endOfMonth(today)));
    } else if (p === 'This Year') {
      setFromDate(fmt(startOfYear(today))); setToDate(fmt(endOfYear(today)));
    } else if (p === 'Last Year') {
      const d = subYears(today, 1);
      setFromDate(fmt(startOfYear(d))); setToDate(fmt(endOfYear(d)));
    }
    // 'Custom' keeps whatever From/To are currently set.
  };

  // Manual month/year navigation (monthly mode only). Pins the selected month,
  // its from/to bounds, and the persisted dateFilter, and snaps the preset label
  // to This/Last Month when it matches — otherwise keeps a monthly preset so we
  // stay in monthly mode (the subtitle shows the actual month either way).
  const pickMonthYear = (m: number, y: number) => {
    setSelMonth(m); setSelYear(y);
    const d = new Date(y, m - 1);
    setFromDate(fmt(startOfMonth(d))); setToDate(fmt(endOfMonth(d)));
    const today = new Date();
    const lm = subMonths(today, 1);
    if (m === today.getMonth() + 1 && y === today.getFullYear()) setDatePreset('This Month');
    else if (m === lm.getMonth() + 1 && y === lm.getFullYear()) setDatePreset('Last Month');
    else setDatePreset('This Month'); // any other month: stay monthly; subtitle reflects the real month
    setDateFilter({ ...dateFilter, view: 'monthly', month: m, year: y });
  };

  // The period filter handed to calculateDashboardKPIs (and used for the
  // category-spend window). Monthly mode → month-bound filter; otherwise a
  // custom from/to window that filterByDateRange already understands. In custom
  // mode we deliberately drop month/year so calculateDashboardKPIs falls back to
  // TODAY for its month-bound bits (upcoming fixed) — matching mbMonth/mbYear.
  const filter: typeof dateFilter = useMemo(() => isMonthlyMode
    ? { ...dateFilter, view: 'monthly', month: selMonth, year: selYear }
    : { ...dateFilter, view: 'custom', month: undefined, year: undefined, start_date: fromDate, end_date: toDate },
    [dateFilter, isMonthlyMode, selMonth, selYear, fromDate, toDate]);

  // Month-bound month/year. In monthly mode this is the selected month; in
  // custom/range mode month-bound widgets (budget, upcoming bills, salary bar,
  // MoM chips) stay anchored to the CURRENT real month.
  const mbMonth = isMonthlyMode ? selMonth : now.getMonth() + 1;
  const mbYear = isMonthlyMode ? selYear : now.getFullYear();
  const period = `${mbYear}-${String(mbMonth).padStart(2, '0')}`;

  // Resolved window for the current selection — one code path for the
  // category-spend pie. In monthly mode it's the selected month's bounds.
  const rangeStart = isMonthlyMode ? fmt(startOfMonth(new Date(selYear, selMonth - 1))) : fromDate;
  const rangeEnd = isMonthlyMode ? fmt(endOfMonth(new Date(selYear, selMonth - 1))) : toDate;
  // An empty bound (user cleared a custom date) means "unbounded" — without this
  // guard the pie/period filters compare against "" and return nothing.
  const inRange = (d: string) => (!rangeStart || d >= rangeStart) && (!rangeEnd || d <= rangeEnd);

  // Human-readable label for the selected period (used in the subtitle).
  const periodLabel = isMonthlyMode
    ? `${MONTHS[selMonth - 1]} ${selYear}`
    : datePreset === 'Custom'
      ? `${formatDate(fromDate)} → ${formatDate(toDate)}`
      : `${datePreset} (${formatDate(fromDate)} → ${formatDate(toDate)})`;

  // ---- Multi-currency wiring ----
  // Base currency is the user's setting; the display currency is a UI-only,
  // persisted choice that defaults to base. All AGGREGATE figures are computed
  // from amounts normalized into the display currency; per-account balances and
  // recent-transaction amounts stay in their own native currency.
  const base = settings?.currency ?? 'INR';
  const rates = settings?.exchange_rates;
  const [displayCur, setDisplayCur] = useDisplayCurrency(base);
  const sym = currencySymbol(displayCur);

  // Build the normalized copies once and reuse across every aggregate calc.
  // When displayCur === base (and/or no rates exist) convertAmount returns the
  // amount unchanged, so totals are identical to the single-currency behaviour.
  const norm = useMemo(
    () => normalizeAmounts(accounts, income, transactions, rates, base, displayCur),
    [accounts, income, transactions, rates, base, displayCur]
  );

  // Distinct currencies in use = base + every account currency (deduped).
  const currenciesInUse = useMemo(() => {
    const set = new Set<string>([base]);
    accounts.forEach(a => { if (a.currency) set.add(a.currency); });
    return Array.from(set);
  }, [accounts, base]);

  // account id -> native currency, for showing raw amounts in their own currency.
  const acctCurrency = useMemo(() => {
    const m = new Map<string, string>();
    accounts.forEach(a => m.set(a.id, a.currency || base));
    return m;
  }, [accounts, base]);
  // A transaction's native currency = its from-account's (or to-account's)
  // currency — mirrors how normalizeAmounts picks the source currency.
  const txSymbol = (tx: { from_account_id?: string | null; to_account_id?: string | null }) =>
    currencySymbol(acctCurrency.get(tx.from_account_id ?? tx.to_account_id ?? '') || base);

  // Fixed-expense amounts converted from each bill's from-account native
  // currency into the display currency — so upcoming totals don't mix ฿ and ₹.
  const displayFixedExpenses = useMemo(() => {
    const curById = (id?: string | null) => accounts.find(a => a.id === id)?.currency || base;
    return fixedExpenses.map(fe => ({
      ...fe,
      amount: convertAmount(fe.amount, (fe.from_account_id && curById(fe.from_account_id)) || base, displayCur, rates, base),
    }));
  }, [fixedExpenses, accounts, base, displayCur, rates]);

  // RAW balances — each account in its own native currency (Account Balances
  // list). rates/base let cross-currency transfers credit the correct amount.
  const balances = useMemo(() => calculateAccountBalances(accounts, income, transactions, rates, base), [accounts, income, transactions, rates, base]);
  // NORMALIZED balances — every figure in the display currency (KPI totals, alerts).
  const normBalances = useMemo(() => calculateAccountBalances(norm.accounts, norm.income, norm.transactions), [norm]);
  const kpis = useMemo(() => settings ? calculateDashboardKPIs(norm.accounts, norm.income, norm.transactions, displayFixedExpenses, filter, settings) : null, [norm, displayFixedExpenses, filter, settings]);
  const budgetStatus = useMemo(() => calculateBudgetStatus(budgets, norm.transactions, displayFixedExpenses, now, mbMonth, mbYear), [budgets, norm.transactions, displayFixedExpenses, mbMonth, mbYear]);
  const trends = useMemo(() => buildMonthlyTrends(norm.income, norm.transactions, 12), [norm.income, norm.transactions]);

  // Net worth at the end of each of the last 12 months, all in the DISPLAY
  // currency (norm.* is already converted). Mirrors the dashboard net-worth
  // definition: cash + savings + investment − card debt, excluding family/shared.
  const netWorthTrend = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 12 }, (_, i) => {
      // last day of the month, i months ago (i=11 oldest ... 0 = current month)
      const d = new Date(today.getFullYear(), today.getMonth() - (11 - i) + 1, 0);
      const cutoff = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const incTo = norm.income.filter(x => x.date <= cutoff);
      const txTo = norm.transactions.filter(t => t.date <= cutoff);
      const bals = calculateAccountBalances(norm.accounts, incTo, txTo);
      let nw = 0;
      bals.forEach(b => {
        if (!shown(b)) return;
        if (b.is_credit_card) { nw -= (b.outstanding ?? 0); return; }
        const role = accountRole(b.account);
        if (role === 'family') return;            // exclude family/shared (matches dashboard net worth)
        nw += b.balance;                           // cash + savings + investment
      });
      return { month: d.toLocaleString('default', { month: 'short' }) + ' ' + String(d.getFullYear()).slice(2), netWorth: Math.round(nw) };
    });
  }, [norm]);
  // Category-spend pie follows the SELECTED period: the resolved from/to window
  // (custom/range mode) or the selected month's bounds (monthly mode) — one path.
  const catSpend = useMemo(() => getCategorySpend(
    norm.transactions.filter(t => inRange(t.date)),
    categories.map(c => ({ name: c.name, color: c.color }))
  ), [norm.transactions, rangeStart, rangeEnd, categories]);
  const activeAlerts = useMemo(() => generateAlerts(budgetStatus, normBalances, displayFixedExpenses, settings ?? { safe_spend_buffer: 5000 } as any, sym), [budgetStatus, normBalances, displayFixedExpenses, settings, sym]);

  const balOf = (id?: string) => normBalances.find(b => b.account.id === id);

  // Derived figures.
  // RAW (native-currency) balances — used only by the Account Balances list and
  // the salary-account picker, both of which are currency-agnostic / native.
  const bankBalances = useMemo(() => balances.filter(b => !b.is_credit_card && b.account.is_active), [balances]);
  const ccBalances = useMemo(() => balances.filter(b => b.is_credit_card && shown(b)), [balances]);
  // NORMALIZED (display-currency) role buckets — power the KPI totals and the
  // breakdown lists inside each card's detail modal, so sums match the headline.
  const ccBalancesNorm = useMemo(() => normBalances.filter(b => b.is_credit_card && shown(b)), [normBalances]);
  const cashBalances = useMemo(() => normBalances.filter(b => shown(b) && accountRole(b.account) === 'cash'), [normBalances]);
  const savingsBalances = useMemo(() => normBalances.filter(b => shown(b) && accountRole(b.account) === 'savings'), [normBalances]);
  const investBalances = useMemo(() => normBalances.filter(b => shown(b) && accountRole(b.account) === 'investment'), [normBalances]);
  const familyBalances = useMemo(() => normBalances.filter(b => shown(b) && accountRole(b.account) === 'family'), [normBalances]);
  const investTotal = useMemo(() => investBalances.reduce((s, b) => s + b.balance, 0), [investBalances]);
  const familyTotal = useMemo(() => familyBalances.reduce((s, b) => s + b.balance, 0), [familyBalances]);
  const netWorth = (kpis?.spendable_balance ?? 0) + (kpis?.savings_balance ?? 0) + investTotal - (kpis?.total_cc_outstanding ?? 0);
  const buffer = settings?.safe_spend_buffer ?? 0;
  const spendable = kpis?.spendable_balance ?? 0;
  const upcoming = kpis?.upcoming_fixed_expenses ?? 0;
  const ccOutstanding = kpis?.total_cc_outstanding ?? 0;

  // Fixed expenses still DUE this month and not yet posted (matches the
  // corrected "upcoming" total — excludes already-paid and other-month dues).
  const upcomingFixedList = useMemo(() => {
    const postedKeys = new Set(transactions.filter(t => t.fixed_expense_id && t.period).map(t => `${t.fixed_expense_id}:${t.period}`));
    return displayFixedExpenses
      .filter(fe => {
        if (!fe.is_active) return false;
        const occ = safeDueDate(fe.due_day, mbYear, mbMonth - 1);
        if (fe.start_date && occ < fe.start_date) return false;
        if (fe.end_date && occ > fe.end_date) return false;
        return !postedKeys.has(`${fe.id}:${period}`);
      })
      .map(fe => ({ fe, occ: safeDueDate(fe.due_day, mbYear, mbMonth - 1) }))
      .sort((a, b) => a.occ.localeCompare(b.occ));
  }, [displayFixedExpenses, transactions, mbYear, mbMonth, period]);

  // Split the PERIOD's "saving" transactions into true savings vs investments
  // (a saving whose destination is an investment account is an investment).
  // Filtered by the same resolved window as kpis.total_savings so the split
  // nets cleanly — month bounds in monthly mode, the from/to range otherwise.
  const investAcctIds = useMemo(() => new Set(investBalances.map(b => b.account.id)), [investBalances]);
  // Use normalized transactions so this nets cleanly against kpis.total_savings
  // (also normalized) when building the savings-vs-invested split.
  const investedPeriod = useMemo(() => norm.transactions.filter(t => t.type === 'saving' && inRange(t.date) && t.to_account_id && investAcctIds.has(t.to_account_id)).reduce((s, t) => s + t.amount, 0), [norm.transactions, rangeStart, rangeEnd, investAcctIds]);
  const savedPeriod = (kpis?.total_savings ?? 0) - investedPeriod;

  // For Safe-to-Spend, reserve only bank/cash-paid bills — card-charged ones
  // are already captured in the card outstanding, so counting them here too
  // would double-count them (F8).
  const ccAcctIds = useMemo(() => new Set(accounts.filter(a => a.is_credit_card).map(a => a.id)), [accounts]);
  const bankPaidUpcomingList = useMemo(() => upcomingFixedList.filter(({ fe }) => !(fe.from_account_id && ccAcctIds.has(fe.from_account_id))), [upcomingFixedList, ccAcctIds]);
  const bankPaidUpcoming = useMemo(() => bankPaidUpcomingList.reduce((s, { fe }) => s + fe.amount, 0), [bankPaidUpcomingList]);
  // Honest safe-to-spend (can be negative): spendable − bank-paid bills − card debt − buffer.
  const trueSafe = Math.round(spendable - bankPaidUpcoming - ccOutstanding - buffer);

  // Salary detection & monthly limit. The salary bar is a MONTH-BOUND widget, so
  // both figures use the month-bound period (selected month in monthly mode, the
  // real current month otherwise). Normalized so they compare like-for-like in
  // the display currency. In monthly mode spentThisMonth === kpis.total_expense.
  const salaryThisMonth = useMemo(() => norm.income.filter(i => (i.category || '').toLowerCase().includes('salary') && i.date.startsWith(period)).reduce((s, i) => s + i.amount, 0), [norm.income, period]);
  const spentThisMonth = useMemo(() => norm.transactions.filter(t => t.type === 'expense' && t.date.startsWith(period)).reduce((s, t) => s + t.amount, 0), [norm.transactions, period]);
  const salaryLeft = salaryThisMonth - spentThisMonth;
  const salaryPct = salaryThisMonth > 0 ? Math.min(100, Math.max(0, (spentThisMonth / salaryThisMonth) * 100)) : 0;

  // Salary account = where salary lands (falls back to a bank account)
  const salaryAccount = useMemo(() => {
    const sal = income.filter(i => (i.category || '').toLowerCase().includes('salary')).sort((a, b) => b.date.localeCompare(a.date));
    const fromSal = sal.length ? accounts.find(a => a.id === sal[0].to_account_id && !a.is_credit_card) : undefined;
    if (fromSal) return fromSal;
    const bank = accounts.find(a => a.is_active && !a.is_credit_card && (a.account_type || '').toLowerCase().includes('bank'));
    if (bank) return bank;
    return [...bankBalances].sort((x, y) => y.balance - x.balance)[0]?.account;
  }, [income, accounts, bankBalances]);
  const salaryAccBal = Math.round(balOf(salaryAccount?.id)?.balance ?? 0);
  // From normalized transactions so the swept amount displays in the chosen currency.
  const sweepThisMonth = useMemo(() => norm.transactions.find(t => t.type === 'saving' && (t.description || '').toLowerCase().startsWith('auto: leftover') && t.date.startsWith(period)), [norm.transactions, period]);

  // Auto-post any due fixed expenses on load (unchanged behaviour).
  useEffect(() => {
    if (isLoading || dashboardAutoRan || fixedExpenses.length === 0) return;
    dashboardAutoRan = true;
    (async () => {
      try {
        const sb = createClient();
        const { data: { user } } = await sb.auth.getUser();
        if (!user) return;
        const state = useAppStore.getState();
        const res = await runAutoProcess({ userId: user.id, fixedExpenses: state.fixedExpenses, transactions: state.transactions, sb, addTransaction: state.addTransaction, updateFixedExpense: state.updateFixedExpense, asOf: new Date() });
        if (res.created > 0) toast.success(`Auto-posted ${res.created} recurring entr${res.created === 1 ? 'y' : 'ies'} · ${formatCurrency(res.totalAmount, sym)}`);
      } catch { /* stay silent on load */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, fixedExpenses.length]);

  // Auto-process any due recurring income entries on load.
  useEffect(() => {
    if (isLoading || incomeAutoRan || recurringIncome.length === 0) return;
    incomeAutoRan = true;
    (async () => {
      try {
        const sb = createClient();
        const { data: { user } } = await sb.auth.getUser();
        if (!user) return;
        const state = useAppStore.getState();
        const r = await runAutoProcessIncome(sb, state.recurringIncome, user.id);
        if (r.processed > 0) {
          toast.success(`Auto-processed ${r.processed} recurring income entr${r.processed > 1 ? 'ies' : 'y'}`);
          state.loadAll(user.id);
        }
      } catch { /* stay silent on load */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, recurringIncome.length]);

  if (isLoading) return <LoadingSkeleton />;

  // Net-cashflow breakdown rows — savings split out from investments.
  const netRows: DetailRow[] = [
    { label: 'Income', amount: kpis?.total_income ?? 0, sign: '+' },
    { label: 'Expenses', amount: kpis?.total_expense ?? 0, sign: '-' },
    { label: 'Moved to savings', amount: savedPeriod, sign: '-' },
  ];
  if (investedPeriod !== 0) netRows.push({ label: 'Invested (SIP, funds)', amount: investedPeriod, sign: '-' });

  // MoM delta chips — derived directly from kpis (already computed in calculateDashboardKPIs)
  const momIncDelta = kpis?.mom_income_delta ?? 0;
  const momExpDelta = kpis?.mom_expense_delta ?? 0;
  const momSavDelta = kpis?.mom_savings_delta ?? 0;
  const momNetDelta = (kpis?.mom_income_delta ?? 0) - (kpis?.mom_expense_delta ?? 0) - (kpis?.mom_savings_delta ?? 0);
  const savingsRate = kpis?.savings_rate ?? 0;

  // Net-worth trend caption: latest value and change vs 12 months ago.
  const nwCurrent = netWorthTrend[netWorthTrend.length - 1]?.netWorth ?? 0;
  const nwYearAgo = netWorthTrend[0]?.netWorth ?? 0;
  const nwChange = nwCurrent - nwYearAgo;

  // ---- Card definitions (value + the detail panel each opens) ----
  const cards: { label: string; value: number; tone: 'pos' | 'neg' | 'plain'; sub: string; detail: DetailData }[] = [
    {
      label: 'Safe to spend', value: trueSafe, tone: trueSafe >= 0 ? 'pos' : 'neg', sub: 'after bills + buffer',
      detail: {
        title: 'Safe to spend', value: trueSafe, tone: trueSafe >= 0 ? 'pos' : 'neg',
        blurb: trueSafe >= 0 ? 'What you can safely spend after setting aside upcoming bills and your buffer.' : "You're over budget once upcoming bills are set aside.",
        rows: [
          { label: 'Spendable balance', amount: spendable, sign: '+' },
          { label: 'Upcoming bank bills', amount: bankPaidUpcoming, sign: '-' },
          { label: 'Credit card outstanding', amount: ccOutstanding, sign: '-' },
          { label: 'Safety buffer', amount: buffer, sign: '-' },
        ],
        totalLabel: 'Safe to spend',
        listTitle: 'Bank-paid bills reserved',
        list: bankPaidUpcomingList.map(({ fe }) => ({ label: fe.name, amount: fe.amount })),
      },
    },
    {
      label: 'Spendable', value: kpis?.spendable_balance ?? 0, tone: 'plain', sub: 'cash you can spend now',
      detail: {
        title: 'Spendable', value: kpis?.spendable_balance ?? 0, tone: 'plain',
        blurb: 'Cash you can spend right now. Excludes savings, investments and family/shared money.',
        listTitle: 'Cash accounts',
        list: cashBalances.map(b => ({ label: b.account.name, amount: b.balance })),
      },
    },
    {
      label: 'Savings', value: kpis?.savings_balance ?? 0, tone: 'plain', sub: 'set aside',
      detail: {
        title: 'Savings', value: kpis?.savings_balance ?? 0, tone: 'plain',
        blurb: 'Money set aside in savings — kept separate from day-to-day spending.',
        listTitle: 'Savings accounts',
        list: savingsBalances.map(b => ({ label: b.account.name, amount: b.balance })),
      },
    },
    {
      label: 'Investments', value: investTotal, tone: 'plain', sub: 'long-term · SIP, funds',
      detail: {
        title: 'Investments', value: investTotal, tone: 'plain',
        blurb: 'Long-term investments such as SIPs. Counted in your net worth, but not in spendable or savings.',
        listTitle: 'Investment accounts',
        list: investBalances.map(b => ({ label: b.account.name, amount: b.balance })),
      },
    },
    {
      label: 'CC outstanding', value: kpis?.total_cc_outstanding ?? 0, tone: 'neg', sub: 'owed on cards',
      detail: {
        title: 'Credit card outstanding', value: kpis?.total_cc_outstanding ?? 0, tone: 'neg',
        blurb: 'Total you currently owe across all credit cards.',
        listTitle: 'Cards',
        list: ccBalancesNorm.map(b => ({ label: b.account.name, amount: b.outstanding ?? 0 })),
      },
    },
    {
      label: 'Net cashflow', value: kpis?.net_cashflow ?? 0, tone: (kpis?.net_cashflow ?? 0) >= 0 ? 'pos' : 'neg', sub: 'income − exp − savings',
      detail: {
        title: 'Net cashflow', value: kpis?.net_cashflow ?? 0, tone: (kpis?.net_cashflow ?? 0) >= 0 ? 'pos' : 'neg',
        blurb: 'What is left this month after spending and money moved to savings or investments.',
        rows: netRows,
        totalLabel: 'Net cashflow',
      },
    },
    {
      label: 'Income this month', value: kpis?.total_income ?? 0, tone: 'pos', sub: `spent ${formatCurrency(kpis?.total_expense ?? 0, sym)}`,
      detail: {
        title: 'Income this month', value: kpis?.total_income ?? 0, tone: 'pos',
        blurb: 'Total money received this month, and what is left after spending.',
        rows: [
          { label: 'True income (salary etc.)', amount: kpis?.true_income ?? 0, sign: '+' },
          { label: 'Other / family money', amount: (kpis?.total_income ?? 0) - (kpis?.true_income ?? 0), sign: '+' },
        ],
        totalLabel: 'Total income',
        listTitle: "After this month's spending",
        list: [
          { label: 'Personal expense', amount: kpis?.personal_expense ?? 0 },
          { label: 'Family / shared expense', amount: kpis?.family_expense ?? 0 },
          { label: 'Left (income − spending)', amount: (kpis?.total_income ?? 0) - (kpis?.total_expense ?? 0) },
        ],
        link: { href: '/dashboard/transactions', label: 'View transactions' },
      },
    },
    {
      label: 'Upcoming fixed', value: upcoming, tone: 'plain', sub: 'still due this month',
      detail: {
        title: 'Upcoming fixed payments', value: upcoming, tone: 'plain',
        blurb: "Recurring payments still due this month that you haven't paid yet. Ones already paid this month, or due in another month, aren't counted.",
        listTitle: 'Due this month, not yet paid',
        list: upcomingFixedList.map(({ fe, occ }) => ({ label: `${fe.name} · ${formatDate(occ)}`, amount: fe.amount })),
        link: { href: '/dashboard/fixed-expenses', label: 'Manage fixed expenses' },
      },
    },
  ];

  const sweepCard: { label: string; value: number; tone: 'pos' | 'neg' | 'plain'; sub: string; detail: DetailData } = sweepThisMonth
    ? {
        label: 'Swept to savings', value: sweepThisMonth.amount, tone: 'plain', sub: 'leftover moved this month',
        detail: {
          title: 'Payday sweep', value: sweepThisMonth.amount, tone: 'plain',
          blurb: 'On payday, last month\'s leftover in your salary account is moved to savings so you start fresh on the new salary.',
          rows: [
            { label: `Leftover in ${salaryAccount?.name ?? 'salary account'}`, amount: sweepThisMonth.amount, sign: '+' },
            { label: 'Moved to Savings', amount: sweepThisMonth.amount, sign: '-' },
          ],
          totalLabel: 'Remaining (reset to new salary)',
          link: { href: '/dashboard/transactions', label: 'View the sweep entry' },
        },
      }
    : {
        label: 'Ready to sweep', value: salaryAccBal > 0 ? salaryAccBal : 0, tone: 'plain', sub: 'moves to savings next payday',
        detail: {
          title: 'Payday sweep', value: salaryAccBal > 0 ? salaryAccBal : 0, tone: 'plain',
          blurb: 'When your next salary lands, this leftover in your salary account is automatically moved to your Savings bucket — so the new month starts fresh on the new salary.',
          rows: [
            { label: `Current balance in ${salaryAccount?.name ?? 'salary account'}`, amount: salaryAccBal, sign: '+' },
          ],
          totalLabel: 'Will move to Savings on payday',
        },
      };

  const allCards = [...cards, sweepCard];

  const toneClass = (t: 'pos' | 'neg' | 'plain') => t === 'neg' ? 'amount-negative' : t === 'pos' ? 'amount-positive' : 'amount-neutral';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Financial overview — {periodLabel}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {currenciesInUse.length > 1 && (
            <CurrencySelect value={displayCur} onChange={setDisplayCur} options={currenciesInUse} />
          )}
          {/* Flexible period control: preset + (monthly month/year) or (custom From/To) */}
          <div className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 border" style={{ borderColor: 'var(--border-default)', background: 'transparent' }}>
            <CalendarRange size={15} style={{ color: 'var(--text-muted)' }} className="ml-1 flex-shrink-0" />
            <select className="form-select text-sm py-1.5 px-2 pr-7 w-auto border-0 bg-transparent" value={datePreset} onChange={e => applyDatePreset(e.target.value as DatePreset)} title="Quick period">
              {DATE_PRESETS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            {isMonthlyMode ? (
              <>
                <select className="form-select text-sm py-1.5 px-2 pr-7 w-auto border-0 bg-transparent" value={selMonth} onChange={e => pickMonthYear(+e.target.value, selYear)} title="Month">
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
                <select className="form-select text-sm py-1.5 px-2 pr-7 w-auto border-0 bg-transparent" value={selYear} onChange={e => pickMonthYear(selMonth, +e.target.value)} title="Year">
                  {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </>
            ) : (
              <>
                <input type="date" className="form-input text-sm py-1.5 px-2 w-auto border-0 bg-transparent" value={fromDate} onChange={e => { setFromDate(e.target.value); setDatePreset('Custom'); }} title="From date" />
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>to</span>
                <input type="date" className="form-input text-sm py-1.5 px-2 w-auto border-0 bg-transparent" value={toDate} onChange={e => { setToDate(e.target.value); setDatePreset('Custom'); }} title="To date" />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Alerts */}
      {activeAlerts.length > 0 && (
        <div className="space-y-2">
          {activeAlerts.slice(0, 3).map(a => (
            <div key={a.id} className={`flex items-center gap-3 p-3 rounded-lg border text-sm ${a.severity === 'error' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-800'} dark:bg-opacity-10`}>
              <AlertTriangle size={16} className="flex-shrink-0" />
              <span className="font-medium">{a.title}:</span> <span>{a.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Salary limit bar */}
      <div className="card card-p animate-fade-in-up">
        {salaryThisMonth > 0 ? (
          <>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold flex items-center gap-2"><Wallet size={16} /> Salary used this month</span>
              <span className={`text-sm font-medium ${salaryLeft >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{salaryLeft >= 0 ? `${formatCurrency(salaryLeft, sym)} left` : `Over by ${formatCurrency(-salaryLeft, sym)}`}</span>
            </div>
            <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-tertiary, #e2e8f0)' }}>
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${salaryPct}%`, background: salaryPct >= 100 ? '#ef4444' : '#3b82f6' }} />
            </div>
            <div className="flex justify-between mt-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
              <span>{formatCurrency(spentThisMonth, sym)} spent · {salaryPct.toFixed(0)}%</span>
              <span>of {formatCurrency(salaryThisMonth, sym)} salary</span>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            <Wallet size={16} /> Add this month's salary on the <Link href="/dashboard/income" className="text-blue-600 hover:underline">Income</Link> page to see your monthly limit.
          </div>
        )}
      </div>

      {/* KPI cards (tap for breakdown) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
        {allCards.map((c, i) => {
          // Determine which MoM delta to show for income / expense / savings cards
          let momDelta: number | null = null;
          let momDeltaPositiveIsGood = true;
          if (c.label === 'Income this month') { momDelta = momIncDelta; momDeltaPositiveIsGood = true; }
          else if (c.label === 'Net cashflow') { momDelta = momNetDelta; momDeltaPositiveIsGood = true; }
          // Safe to spend is a balance figure — no MoM delta chip
          else if (c.label === 'Safe to spend') { momDelta = null; }

          // MoM chips are month-to-month concepts — only shown in monthly mode.
          const showDelta = isMonthlyMode && momDelta !== null && Math.abs(momDelta) > 0;
          const deltaGood = momDelta !== null && (momDeltaPositiveIsGood ? momDelta > 0 : momDelta < 0);
          const deltaUp = momDelta !== null && momDelta > 0;

          const accent = CARD_ACCENT[c.label];
          const AccentIcon = accent?.icon;
          return (
            <button
              key={c.label}
              onClick={() => setDetail(c.detail)}
              className="card p-4 text-left w-full relative group overflow-hidden transition-all duration-200 hover:-translate-y-1 hover:shadow-xl active:scale-[0.99] animate-fade-in-up"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              {/* Subtle accent strip on the left edge */}
              {accent && <span className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl" style={{ background: accent.color, opacity: 0.85 }} />}
              <Info size={14} className="absolute top-3 right-3 text-slate-300 group-hover:text-blue-500 transition-colors" />
              <div className="flex items-center gap-2">
                {AccentIcon && (
                  <span className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${accent.color}1a`, color: accent.color }}>
                    <AccentIcon size={15} />
                  </span>
                )}
                <div className="text-xs sm:text-sm truncate" style={{ color: 'var(--text-secondary)' }}>{c.label}</div>
              </div>
              <Amount value={c.value} sym={sym} className={`block text-xl sm:text-2xl font-bold mt-1.5 ${toneClass(c.tone)}`} />
              <div className="text-[11px] sm:text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{c.sub}</div>
              {showDelta && momDelta !== null && (
                <div className={`text-xs mt-1.5 font-medium ${deltaGood ? 'text-emerald-600' : 'text-red-500'}`}>
                  {deltaUp ? '▲' : '▼'} {formatCurrency(Math.abs(momDelta), sym, true)} vs last month
                </div>
              )}
            </button>
          );
        })}

        {/* Savings Rate KPI card */}
        <div
          className="card p-4 text-left w-full relative overflow-hidden animate-fade-in-up"
          style={{ animationDelay: `${allCards.length * 40}ms` }}
        >
          <span className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl" style={{ background: '#14b8a6', opacity: 0.85 }} />
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: '#14b8a61a', color: '#14b8a6' }}>
              <Percent size={15} />
            </span>
            <div className="text-xs sm:text-sm truncate" style={{ color: 'var(--text-secondary)' }}>Savings Rate</div>
          </div>
          <div className={`block text-xl sm:text-2xl font-bold mt-1.5 ${savingsRate >= 20 ? 'text-emerald-600' : savingsRate >= 10 ? 'text-amber-500' : 'text-red-500'}`}>
            {savingsRate.toFixed(1)}%
          </div>
          <div className="text-[11px] sm:text-xs mt-1" style={{ color: 'var(--text-muted)' }}>of true income</div>
          {isMonthlyMode && Math.abs(momSavDelta) > 0 && (
            <div className={`text-xs mt-1.5 font-medium ${momSavDelta > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              {momSavDelta > 0 ? '▲' : '▼'} {formatCurrency(Math.abs(momSavDelta), sym, true)} vs last month
            </div>
          )}
        </div>
      </div>
      <div className="-mt-2 space-y-1 text-xs" style={{ color: 'var(--text-muted)' }}>
        <div className="flex items-center gap-1.5"><Info size={13} /> Tap any card to see exactly how it's calculated.</div>
        <div>
          Net worth (cash + savings + investments − card debt): <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{formatCurrency(netWorth, sym)}</span>
          {familyTotal !== 0 && <> · Family / shared money tracked separately: <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{formatCurrency(familyTotal, sym)}</span></>}
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card card-p animate-fade-in-up">
          <h3 className="section-title text-base mb-1">Income vs Expense vs Savings</h3>
          <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>Last 12 months</p>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={trends} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#22c55e" stopOpacity={0.2} /><stop offset="95%" stopColor="#22c55e" stopOpacity={0} /></linearGradient>
                <linearGradient id="expenseGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} /><stop offset="95%" stopColor="#ef4444" stopOpacity={0} /></linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} tickFormatter={v => `${sym}${(v / 1000).toFixed(0)}K`} />
              <Tooltip formatter={(val: number) => [formatCurrency(val, sym), '']} contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: 'var(--shadow-lg)', fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="income" name="Income" stroke="#22c55e" fill="url(#incomeGrad)" strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="expense" name="Expense" stroke="#ef4444" fill="url(#expenseGrad)" strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="savings" name="Savings" stroke="#3b82f6" strokeWidth={2} dot={false} fill="none" strokeDasharray="4 2" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card card-p animate-fade-in-up">
          <h3 className="section-title text-base mb-1">Expense by Category</h3>
          <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>{periodLabel}</p>
          {catSpend.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-center"><p className="text-sm" style={{ color: 'var(--text-muted)' }}>No expenses for this period</p></div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={catSpend.slice(0, 8)} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="amount" paddingAngle={2}>
                    {catSpend.slice(0, 8).map((entry, index) => <Cell key={index} fill={entry.color} />)}
                  </Pie>
                  <Tooltip formatter={(val: number) => [formatCurrency(val, sym), '']} contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: 'var(--shadow-lg)', fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5 mt-3 max-h-40 overflow-y-auto">
                {catSpend.slice(0, 8).map(c => (
                  <div key={c.category} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: c.color }} />
                    <span className="flex-1 truncate" style={{ color: 'var(--text-secondary)' }}>{c.category}</span>
                    <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{c.percent.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Net Worth Trend */}
      <div className="card card-p animate-fade-in-up">
        <h3 className="section-title text-base mb-1">Net Worth Trend</h3>
        <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>End of month · last 12 months</p>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={netWorthTrend} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="netWorthGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.25} /><stop offset="95%" stopColor="#10b981" stopOpacity={0} /></linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} tickFormatter={v => `${sym}${(v / 1000).toFixed(0)}K`} />
            <Tooltip formatter={(v: number) => [formatCurrency(v, sym), 'Net worth']} contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: 'var(--shadow-lg)', fontSize: 12 }} />
            <Area type="monotone" dataKey="netWorth" name="Net worth" stroke="#10b981" fill="url(#netWorthGrad)" strokeWidth={2} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
        <div className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          Now: <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{formatCurrency(nwCurrent, sym)}</span>
          {nwChange !== 0 && (
            <span className={`ml-2 font-medium ${nwChange > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              {nwChange > 0 ? '▲' : '▼'} {formatCurrency(Math.abs(nwChange), sym)} since last year
            </span>
          )}
        </div>
      </div>

      {/* Accounts + Budget */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card card-p animate-fade-in-up">
          <h3 className="section-title text-base mb-4">Account Balances</h3>
          <div className="space-y-3">
            {[...bankBalances.filter(b => b.account.include_in_dashboard), ...ccBalances.filter(b => (b.outstanding ?? 0) > 0)].map(b => {
              // Each account is shown in ITS OWN native currency (never converted).
              const aSym = currencySymbol(b.account.currency || base);
              return (
              <div key={b.account.id} className="flex items-center gap-3 py-1">
                <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
                  {b.is_credit_card ? <CreditCard size={15} className="text-red-500" /> : <Wallet size={15} className="text-blue-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{b.account.name}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{b.account.account_type}</p>
                </div>
                <span className={`text-sm font-bold ${b.is_credit_card ? 'amount-negative' : b.balance >= 0 ? 'amount-positive' : 'amount-negative'}`}>
                  {b.is_credit_card ? `-${formatCurrency(b.outstanding ?? 0, aSym)}` : formatCurrency(b.balance, aSym)}
                </span>
              </div>
              );
            })}
          </div>
          {ccBalances.some(b => (b.outstanding ?? 0) === 0) && (
            <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>{ccBalances.filter(b => (b.outstanding ?? 0) === 0).length} card(s) at {sym}0 hidden.</p>
          )}
        </div>

        <div className="card card-p animate-fade-in-up">
          <div className="flex items-center justify-between mb-4">
            <h3 className="section-title text-base">Budget Status</h3>
            <Link href="/dashboard/budget" className="text-xs text-blue-600 hover:underline">View all →</Link>
          </div>
          <div className="space-y-3 max-h-72 overflow-y-auto">
            {budgetStatus.length === 0 && <p className="text-sm text-center py-6" style={{ color: 'var(--text-muted)' }}>No budgets set. <Link href="/dashboard/budget" className="text-blue-600 hover:underline">Set budgets →</Link></p>}
            {budgetStatus.map(bs => (
              <div key={bs.category}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{bs.category}</span>
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{formatCurrency(bs.actual_till_date, sym)} / {formatCurrency(bs.monthly_budget, sym)}</span>
                </div>
                <div className="progress-bar">
                  <div className={`progress-fill ${bs.status === 'green' ? 'bg-emerald-500' : bs.status === 'red' ? 'bg-red-500' : 'bg-amber-500'}`} style={{ width: `${Math.min(100, bs.monthly_budget > 0 ? (bs.actual_till_date / bs.monthly_budget) * 100 : 0)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent transactions */}
      <div className="card animate-fade-in-up">
        <div className="flex items-center justify-between p-5 pb-0">
          <h3 className="section-title text-base">Recent Transactions</h3>
          <Link href="/dashboard/transactions" className="text-xs text-blue-600 hover:underline">View all →</Link>
        </div>
        <div className="table-container mt-4 border-0 border-t border-slate-100 dark:border-slate-700 rounded-none rounded-b-xl">
          <table className="data-table">
            <thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Type</th><th className="text-right">Amount</th></tr></thead>
            <tbody>
              {transactions.slice(0, 10).map(tx => (
                <tr key={tx.id}>
                  <td className="text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{tx.date}</td>
                  <td className="max-w-xs"><span className="truncate block" style={{ maxWidth: 200 }}>{tx.description || tx.category || tx.type}</span></td>
                  <td><span className="badge badge-gray text-[10px]">{tx.category ?? '—'}</span></td>
                  <td><span className={`badge text-[10px] ${tx.type === 'expense' ? 'badge-red' : tx.type === 'saving' ? 'badge-blue' : tx.type === 'credit_card_payment' ? 'badge-yellow' : 'badge-gray'}`}>{tx.type.replace(/_/g, ' ')}</span></td>
                  <td className={`text-right font-semibold text-sm ${tx.type === 'expense' ? 'amount-negative' : tx.type === 'saving' ? 'text-blue-600' : 'amount-positive'}`}>{tx.type === 'expense' ? '-' : ''}{formatCurrency(tx.amount, txSymbol(tx))}</td>
                </tr>
              ))}
              {transactions.length === 0 && <tr><td colSpan={5} className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>No transactions yet. <Link href="/dashboard/transactions" className="text-blue-600 hover:underline">Add one →</Link></td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail modal */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'var(--bg-overlay, rgba(15,23,42,0.45))' }} onClick={() => setDetail(null)}>
          <div className="card w-full max-w-md max-h-[90vh] overflow-y-auto animate-fade-in-up" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between p-5 pb-3">
              <div>
                <h2 className="text-base font-semibold">{detail.title}</h2>
                <p className={`text-2xl font-bold mt-1 ${toneClass(detail.tone)}`}>{formatCurrency(detail.value, sym)}</p>
              </div>
              <button onClick={() => setDetail(null)} className="btn-icon"><X size={18} /></button>
            </div>
            <div className="px-5 pb-5 space-y-4">
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{detail.blurb}</p>

              {detail.rows && detail.rows.length > 0 && (
                <div>
                  <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>How it's calculated</p>
                  <div className="rounded-lg p-3 text-sm" style={{ background: 'var(--bg-subtle)' }}>
                    {detail.rows.map((r, i) => (
                      <div key={i} className="flex justify-between py-1">
                        <span style={{ color: 'var(--text-secondary)' }}>{r.sign === '-' ? '− ' : r.sign === '+' ? '+ ' : ''}{r.label}</span>
                        <span className={r.sign === '-' ? 'amount-negative' : 'font-medium'} style={r.sign === '-' ? undefined : { color: 'var(--text-primary)' }}>{r.sign === '-' ? '-' : ''}{formatCurrency(r.amount, sym)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between pt-2 mt-1 border-t border-slate-200 dark:border-slate-700 font-semibold">
                      <span>{detail.totalLabel ?? 'Total'}</span>
                      <span className={toneClass(detail.tone)}>{formatCurrency(detail.value, sym)}</span>
                    </div>
                  </div>
                </div>
              )}

              {detail.list && detail.list.length > 0 && (
                <div>
                  <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>{detail.listTitle ?? 'Breakdown'}</p>
                  <div className="space-y-1 text-sm">
                    {detail.list.map((it, i) => (
                      <div key={i} className="flex justify-between py-0.5" style={{ color: it.muted ? 'var(--text-muted)' : 'var(--text-secondary)' }}>
                        <span className="truncate pr-2">{it.label}</span>
                        <span className="whitespace-nowrap">{formatCurrency(it.amount, sym)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {detail.link && (
                <Link href={detail.link.href} className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline">
                  {detail.link.label} <ArrowRight size={14} />
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="skeleton h-8 w-48 rounded-lg" />
      <div className="skeleton h-16 rounded-xl" />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">{[...Array(7)].map((_, i) => <div key={i} className="skeleton h-24 rounded-xl" />)}</div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4"><div className="lg:col-span-2 skeleton h-64 rounded-xl" /><div className="skeleton h-64 rounded-xl" /></div>
    </div>
  );
}
