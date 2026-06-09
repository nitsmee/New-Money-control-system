'use client';
import { useMemo, useState, useEffect } from 'react';
import { useAppStore } from '@/lib/store/appStore';
import { calculateAccountBalances, calculateBudgetStatus, calculateDashboardKPIs, generateAlerts, formatCurrency, safeDueDate, currencySymbol, convertAmount, normalizeAmounts } from '@/lib/utils/calculations';
import { useDisplayCurrency } from '@/lib/useDisplayCurrency';
import { AlertTriangle, CheckCircle, Info, XCircle, Bell, TrendingDown, CreditCard, Calendar, Shield, X } from 'lucide-react';
import Link from 'next/link';

const SEVERITY_ICON = {
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
  success: CheckCircle,
};

// Presentation-only style tokens per severity. Drive the colored left accent,
// the tinted icon circle and the action button accents — no logic depends on these.
type Severity = 'error' | 'warning' | 'info' | 'success';
const SEVERITY_STYLE: Record<Severity, {
  accent: string;      // left accent border color
  iconWrap: string;    // tinted circle behind the icon
  icon: string;        // icon color
  action: string;      // action button accent
}> = {
  error: {
    accent: 'border-l-red-500',
    iconWrap: 'bg-red-100 dark:bg-red-900/30',
    icon: 'text-red-600 dark:text-red-400',
    action: 'text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 border-red-200 dark:border-red-800',
  },
  warning: {
    accent: 'border-l-amber-500',
    iconWrap: 'bg-amber-100 dark:bg-amber-900/30',
    icon: 'text-amber-600 dark:text-amber-400',
    action: 'text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/30 border-amber-200 dark:border-amber-800',
  },
  info: {
    accent: 'border-l-blue-500',
    iconWrap: 'bg-blue-100 dark:bg-blue-900/30',
    icon: 'text-blue-600 dark:text-blue-400',
    action: 'text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 border-blue-200 dark:border-blue-800',
  },
  success: {
    accent: 'border-l-emerald-500',
    iconWrap: 'bg-emerald-100 dark:bg-emerald-900/30',
    icon: 'text-emerald-600 dark:text-emerald-400',
    action: 'text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800',
  },
};

// Section metadata for the grouped severity sections (label + matching list).
const SECTION_META: { key: Severity; label: string }[] = [
  { key: 'error', label: 'Critical' },
  { key: 'warning', label: 'Warnings' },
  { key: 'info', label: 'Info' },
];

const DISMISSED_KEY = 'mcs_dismissed_alerts';
const SNOOZE_MS = 86400000; // 24h

export default function AlertsPage() {
  const { accounts, income, transactions, budgets, fixedExpenses, settings } = useAppStore();
  const today = new Date();

  // ---- Multi-currency wiring ----
  // All alert thresholds, KPIs and messages are computed from amounts
  // normalized into the chosen display currency, so the figures here match the
  // dashboard. Fixed-expense amounts (in their own native account currency) are
  // converted too. When display === base (or rates are missing) every
  // conversion is a no-op and the output is identical to before.
  const base = settings?.currency ?? 'INR';
  const rates = settings?.exchange_rates;
  const [displayCur] = useDisplayCurrency(base);
  const sym = currencySymbol(displayCur);
  const norm = useMemo(
    () => normalizeAmounts(accounts, income, transactions, rates, base, displayCur),
    [accounts, income, transactions, rates, base, displayCur]
  );
  // Fixed-expense amounts converted from their from-account's native currency to display.
  const displayFixedExpenses = useMemo(() => {
    const curOf = new Map(accounts.map(a => [a.id, a.currency || base]));
    return fixedExpenses.map(fe => ({
      ...fe,
      amount: convertAmount(fe.amount, (fe.from_account_id && curOf.get(fe.from_account_id)) || base, displayCur, rates, base),
    }));
  }, [fixedExpenses, accounts, base, displayCur, rates]);

  // NORMALIZED balances/statuses/KPIs — every figure in the display currency.
  const balances = useMemo(() => calculateAccountBalances(norm.accounts, norm.income, norm.transactions), [norm]);
  // Budgets are stored in the BASE currency — convert to display so they're
  // compared against the (already display-currency) normalized spend.
  const displayBudgets = useMemo(() => budgets.map(b => ({ ...b, monthly_budget: convertAmount(b.monthly_budget, base, displayCur, rates, base) })), [budgets, base, displayCur, rates]);
  const budgetStatuses = useMemo(() => calculateBudgetStatus(displayBudgets, norm.transactions, displayFixedExpenses, today, today.getMonth()+1, today.getFullYear()), [displayBudgets, norm.transactions, displayFixedExpenses]);
  const alerts = useMemo(() => generateAlerts(budgetStatuses, balances, displayFixedExpenses, settings ?? { safe_spend_buffer:5000 } as any, sym), [budgetStatuses, balances, displayFixedExpenses, settings, sym]);
  // Same engine the dashboard uses — guarantees the Safe-to-Spend number here matches it.
  const kpis = useMemo(() => calculateDashboardKPIs(norm.accounts, norm.income, norm.transactions, displayFixedExpenses, { view: 'monthly', month: today.getMonth()+1, year: today.getFullYear() }, settings ?? { safe_spend_buffer:5000 } as any), [norm, displayFixedExpenses, settings]);

  // Additional computed alerts
  const extraAlerts = useMemo(() => {
    const extra = [];

    // High CC outstanding (>50K)
    balances.filter(b => b.is_credit_card && (b.outstanding??0) > 50000).forEach(b => {
      extra.push({ id:`cc-very-high-${b.account.id}`, type:'high_cc', title:`Very High CC Balance: ${b.account.name}`, message:`Outstanding of ${formatCurrency(b.outstanding??0, sym)} is critically high. Prioritize payment.`, severity:'error' as const, actionable:true, action_label:'Go to Transactions', action_link:'/dashboard/transactions' });
    });

    // No transactions this month
    const thisMonth = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;
    const monthTx = transactions.filter(t => t.date.startsWith(thisMonth));
    if (monthTx.length === 0 && today.getDate() > 5) {
      extra.push({ id:'no-tx-month', type:'missing_data', title:'No Transactions This Month', message:`You have no transactions recorded for ${today.toLocaleString('default',{month:'long'})} ${today.getFullYear()}. Remember to log your daily expenses.`, severity:'info' as const, actionable:true, action_label:'Add Transaction', action_link:'/dashboard/transactions' });
    }

    // Safe-to-spend — read from the same engine as the dashboard so the two
    // always agree (correct spendable, bank-paid bills only, no card double-count).
    const safeSpend = kpis.safe_to_spend;
    if (safeSpend < 0) {
      extra.push({ id:'safe-spend-negative', type:'low_safe_spend', title:'Safe-to-Spend is Negative', message:`After upcoming bills, CC dues, and buffer, your safe-to-spend is ${formatCurrency(safeSpend, sym)}. Review your upcoming payments.`, severity:'error' as const, actionable:true, action_label:'View Dashboard', action_link:'/dashboard' });
    } else if (safeSpend < 5000) {
      extra.push({ id:'safe-spend-low', type:'low_safe_spend', title:'Safe-to-Spend is Low', message:`Safe-to-spend is ${formatCurrency(safeSpend, sym)}. Be cautious with discretionary spending.`, severity:'warning' as const, actionable:false });
    }

    // Unprocessed fixed expenses (auto_count=true, due by today but not yet
    // posted this month). Clamp the due day to the real month length so
    // month-end bills (29–31) aren't mis-dated.
    const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    displayFixedExpenses.filter(fe => fe.is_active && fe.auto_count && fe.last_processed_period !== thisMonth).forEach(fe => {
      const occStr = safeDueDate(fe.due_day, today.getFullYear(), today.getMonth());
      if (occStr <= todayStr) {
        extra.push({ id:`unprocessed-${fe.id}`, type:'unprocessed_fixed', title:`Unprocessed Auto-Payment: ${fe.name}`, message:`"${fe.name}" (${formatCurrency(fe.amount, sym)}) was due on the ${fe.due_day}th but hasn't been auto-processed yet.`, severity:'warning' as const, actionable:true, action_label:'Fixed Expenses', action_link:'/dashboard/fixed-expenses' });
      }
    });

    return extra;
  }, [balances, transactions, displayFixedExpenses, settings, sym, today, kpis]);

  const allAlerts = [...alerts, ...extraAlerts];

  // --- Client-side dismiss/snooze (24h, localStorage-backed, no DB) ---
  // Map of alertId -> epoch ms when it was dismissed. Entries older than 24h
  // are pruned on read so those alerts reappear automatically.
  const [dismissed, setDismissed] = useState<Record<string, number>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DISMISSED_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, number>;
      const now = Date.now();
      const fresh: Record<string, number> = {};
      let pruned = false;
      for (const [id, ts] of Object.entries(parsed)) {
        if (typeof ts === 'number' && now - ts < SNOOZE_MS) fresh[id] = ts;
        else pruned = true;
      }
      setDismissed(fresh);
      // Persist the pruned map so stale entries don't linger in storage.
      if (pruned) localStorage.setItem(DISMISSED_KEY, JSON.stringify(fresh));
    } catch {
      // Corrupt/blocked storage — start with an empty snooze map.
      setDismissed({});
    }
  }, []);

  const dismissAlert = (id: string) => {
    setDismissed(prev => {
      const next = { ...prev, [id]: Date.now() };
      try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  };

  const showAllAlerts = () => {
    setDismissed({});
    try { localStorage.removeItem(DISMISSED_KEY); } catch { /* storage unavailable */ }
  };

  const now = Date.now();
  const visibleAlerts = allAlerts.filter(a => {
    const ts = dismissed[a.id];
    return ts === undefined || now - ts >= SNOOZE_MS;
  });
  const hasSnoozed = allAlerts.length > 0 && visibleAlerts.length === 0;

  const errors = visibleAlerts.filter(a => a.severity === 'error');
  const warnings = visibleAlerts.filter(a => a.severity === 'warning');
  const infos = visibleAlerts.filter(a => a.severity === 'info');
  const bySeverity: Record<Severity, typeof visibleAlerts> = {
    error: errors,
    warning: warnings,
    info: infos,
    success: visibleAlerts.filter(a => a.severity === 'success'),
  };

  // Presentation-only summary chips. Counts come straight from the lists above.
  const summaryChips = [
    { label: 'Critical', count: errors.length, style: SEVERITY_STYLE.error, Icon: XCircle },
    { label: 'Warnings', count: warnings.length, style: SEVERITY_STYLE.warning, Icon: AlertTriangle },
    { label: 'Info', count: infos.length, style: SEVERITY_STYLE.info, Icon: Info },
  ];

  // Single source of truth for rendering an alert card (used in every section).
  const renderAlert = (alert: typeof visibleAlerts[number]) => {
    const Icon = SEVERITY_ICON[alert.severity];
    const s = SEVERITY_STYLE[alert.severity];
    return (
      <div
        key={alert.id}
        className={`card border-l-4 ${s.accent} p-4 flex items-start gap-3.5 transition-all`}
      >
        <div className={`flex-shrink-0 w-10 h-10 rounded-full grid place-items-center ${s.iconWrap}`}>
          <Icon size={20} className={s.icon}/>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm break-words" style={{ color:'var(--text-primary)' }}>{alert.title}</p>
          <p className="text-sm mt-0.5 break-words" style={{ color:'var(--text-secondary)' }}>{alert.message}</p>
        </div>
        <div className="flex-shrink-0 flex items-center gap-1.5 self-start">
          {alert.actionable && alert.action_link && (
            <Link
              href={alert.action_link}
              className={`hidden sm:inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${s.action}`}
            >
              {alert.action_label ?? 'Take Action'}
              <span aria-hidden>→</span>
            </Link>
          )}
          <button
            onClick={() => dismissAlert(alert.id)}
            aria-label="Dismiss alert"
            className="p-1.5 rounded-lg opacity-50 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 transition-all"
          >
            <X size={16}/>
          </button>
        </div>
      </div>
    );
  };

  // Mobile-only action link row (kept out of the flex header so cards stay tidy
  // on narrow screens). Same link/logic as the inline button above.
  const renderMobileAction = (alert: typeof visibleAlerts[number]) => {
    if (!alert.actionable || !alert.action_link) return null;
    const s = SEVERITY_STYLE[alert.severity];
    return (
      <Link
        href={alert.action_link}
        className={`sm:hidden inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${s.action}`}
      >
        {alert.action_label ?? 'Take Action'}
        <span aria-hidden>→</span>
      </Link>
    );
  };

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Alerts</h1>
          <p className="text-sm mt-0.5" style={{ color:'var(--text-secondary)' }}>Real-time financial health checks and warnings</p>
        </div>
        <div className="flex items-center gap-2">
          {errors.length > 0 && <span className="badge badge-red"><XCircle size={12}/> {errors.length} critical</span>}
          {warnings.length > 0 && <span className="badge badge-yellow"><AlertTriangle size={12}/> {warnings.length} warnings</span>}
          {allAlerts.length === 0 && <span className="badge badge-green"><CheckCircle size={12}/> All clear</span>}
        </div>
      </div>

      {allAlerts.length === 0 && (
        <div className="card card-p text-center py-16 animate-fade-in-up">
          <div className="mx-auto mb-5 w-20 h-20 rounded-full grid place-items-center bg-emerald-100 dark:bg-emerald-900/30">
            <CheckCircle size={40} className="text-emerald-600 dark:text-emerald-400"/>
          </div>
          <h2 className="text-xl font-bold mb-2" style={{ color:'var(--text-primary)' }}>All Clear!</h2>
          <p className="text-sm max-w-sm mx-auto" style={{ color:'var(--text-muted)' }}>No alerts at this time. Your finances are looking healthy — keep it up.</p>
        </div>
      )}

      {hasSnoozed && (
        <div className="card card-p text-center py-16 animate-fade-in-up">
          <div className="mx-auto mb-5 w-20 h-20 rounded-full grid place-items-center bg-blue-100 dark:bg-blue-900/30">
            <Bell size={36} className="text-blue-600 dark:text-blue-400"/>
          </div>
          <h2 className="text-xl font-bold mb-2" style={{ color:'var(--text-primary)' }}>All alerts snoozed for 24h</h2>
          <p className="text-sm mb-5 max-w-sm mx-auto" style={{ color:'var(--text-muted)' }}>You&apos;ve dismissed every active alert. They&apos;ll reappear automatically after 24 hours.</p>
          <button onClick={showAllAlerts} className="btn btn-sm btn-secondary mx-auto">Show all</button>
        </div>
      )}

      {/* Summary Chips */}
      {visibleAlerts.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {summaryChips.map(item => (
            <div key={item.label} className="card card-p min-w-0 flex items-center gap-2 sm:gap-3">
              <div className={`flex-shrink-0 w-9 h-9 sm:w-11 sm:h-11 rounded-full grid place-items-center ${item.style.iconWrap}`}>
                <item.Icon size={20} className={item.style.icon}/>
              </div>
              <div className="min-w-0">
                <p className="kpi-label truncate">{item.label}</p>
                <p className={`text-2xl font-bold leading-none mt-1 ${item.style.icon}`}>{item.count}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Grouped Alert Sections (Critical → Warnings → Info) */}
      {visibleAlerts.length > 0 && (
        <div className="space-y-6">
          {SECTION_META.map(({ key, label }) => {
            const list = bySeverity[key];
            if (list.length === 0) return null;
            const s = SEVERITY_STYLE[key];
            return (
              <section key={key} className="space-y-3">
                <div className="flex items-center gap-2">
                  <h2 className={`text-sm font-semibold uppercase tracking-wider ${s.icon}`}>{label}</h2>
                  <span className="badge badge-gray">{list.length}</span>
                </div>
                <div className="space-y-3">
                  {list.map(alert => (
                    <div key={alert.id} className="space-y-2">
                      {renderAlert(alert)}
                      {renderMobileAction(alert)}
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Financial Health Checklist */}
      <div className="card card-p">
        <div className="flex items-center gap-2 mb-4">
          <Shield size={18} style={{ color:'var(--text-secondary)' }}/>
          <h3 className="section-title text-base">Financial Health Checklist</h3>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
          {[
            { label:'All accounts have initial balances set', check: accounts.length > 0 && transactions.some(t => t.type==='initial_balance'), link:'/dashboard/transactions' },
            { label:'Budgets set for all expense categories', check: budgets.length > 0, link:'/dashboard/budget' },
            { label:'At least one savings account configured', check: accounts.some(a => a.include_in_goal_savings), link:'/dashboard/settings' },
            { label:'Income recorded for this month', check: income.some(i => i.date.startsWith(`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`)), link:'/dashboard/income' },
            { label:'No credit cards with very high outstanding (>₹50K)', check: !balances.some(b => b.is_credit_card && (b.outstanding??0) > 50000), link:'/dashboard/transactions' },
            { label:'Goals configured for future planning', check: true, link:'/dashboard/goals' },
          ].map((item, i) => (
            <div key={i} className="flex items-center gap-3 py-2.5">
              {item.check
                ? <span className="flex-shrink-0 w-6 h-6 rounded-full grid place-items-center bg-emerald-100 dark:bg-emerald-900/30"><CheckCircle size={14} className="text-emerald-600 dark:text-emerald-400"/></span>
                : <span className="flex-shrink-0 w-6 h-6 rounded-full grid place-items-center bg-red-100 dark:bg-red-900/30"><XCircle size={14} className="text-red-600 dark:text-red-400"/></span>}
              <span className={`text-sm flex-1 min-w-0 break-words ${item.check ? '' : 'font-medium text-red-600 dark:text-red-400'}`} style={item.check ? { color:'var(--text-secondary)' } : undefined}>{item.label}</span>
              {!item.check && (
                <Link href={item.link} className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline flex-shrink-0">Fix →</Link>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
