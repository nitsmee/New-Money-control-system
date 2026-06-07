'use client';
import { useMemo, useState, useEffect } from 'react';
import { useAppStore } from '@/lib/store/appStore';
import { calculateAccountBalances, calculateBudgetStatus, calculateDashboardKPIs, generateAlerts, formatCurrency, safeDueDate } from '@/lib/utils/calculations';
import { AlertTriangle, CheckCircle, Info, XCircle, Bell, TrendingDown, CreditCard, Calendar, Shield, X } from 'lucide-react';
import Link from 'next/link';

const SEVERITY_ICON = {
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
  success: CheckCircle,
};
const SEVERITY_STYLE = {
  error: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300',
  warning: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300',
  info: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300',
  success: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300',
};

const DISMISSED_KEY = 'mcs_dismissed_alerts';
const SNOOZE_MS = 86400000; // 24h

export default function AlertsPage() {
  const { accounts, income, transactions, budgets, fixedExpenses, settings } = useAppStore();
  const sym = settings?.currency_symbol ?? '₹';
  const today = new Date();

  const balances = useMemo(() => calculateAccountBalances(accounts, income, transactions), [accounts, income, transactions]);
  const budgetStatuses = useMemo(() => calculateBudgetStatus(budgets, transactions, fixedExpenses, today, today.getMonth()+1, today.getFullYear()), [budgets, transactions, fixedExpenses]);
  const alerts = useMemo(() => generateAlerts(budgetStatuses, balances, fixedExpenses, settings ?? { safe_spend_buffer:5000 } as any), [budgetStatuses, balances, fixedExpenses, settings]);
  // Same engine the dashboard uses — guarantees the Safe-to-Spend number here matches it.
  const kpis = useMemo(() => calculateDashboardKPIs(accounts, income, transactions, fixedExpenses, { view: 'monthly', month: today.getMonth()+1, year: today.getFullYear() }, settings ?? { safe_spend_buffer:5000 } as any), [accounts, income, transactions, fixedExpenses, settings]);

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
    fixedExpenses.filter(fe => fe.is_active && fe.auto_count && fe.last_processed_period !== thisMonth).forEach(fe => {
      const occStr = safeDueDate(fe.due_day, today.getFullYear(), today.getMonth());
      if (occStr <= todayStr) {
        extra.push({ id:`unprocessed-${fe.id}`, type:'unprocessed_fixed', title:`Unprocessed Auto-Payment: ${fe.name}`, message:`"${fe.name}" (${formatCurrency(fe.amount, sym)}) was due on the ${fe.due_day}th but hasn't been auto-processed yet.`, severity:'warning' as const, actionable:true, action_label:'Fixed Expenses', action_link:'/dashboard/fixed-expenses' });
      }
    });

    return extra;
  }, [balances, transactions, fixedExpenses, settings, sym, today, kpis]);

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

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Alerts</h1>
          <p className="text-sm" style={{ color:'var(--text-secondary)' }}>Real-time financial health checks and warnings</p>
        </div>
        <div className="flex items-center gap-2">
          {errors.length > 0 && <span className="badge badge-red">{errors.length} critical</span>}
          {warnings.length > 0 && <span className="badge badge-yellow">{warnings.length} warnings</span>}
          {allAlerts.length === 0 && <span className="badge badge-green">All clear ✓</span>}
        </div>
      </div>

      {allAlerts.length === 0 && (
        <div className="card card-p text-center py-16">
          <CheckCircle size={48} className="mx-auto mb-4 text-emerald-400"/>
          <h2 className="text-xl font-bold mb-2 text-emerald-600">All Clear!</h2>
          <p className="text-sm" style={{ color:'var(--text-muted)' }}>No alerts at this time. Your finances are looking healthy.</p>
        </div>
      )}

      {hasSnoozed && (
        <div className="card card-p text-center py-16">
          <Bell size={48} className="mx-auto mb-4 text-blue-400"/>
          <h2 className="text-xl font-bold mb-2 text-blue-600">All alerts snoozed for 24h</h2>
          <p className="text-sm mb-4" style={{ color:'var(--text-muted)' }}>You&apos;ve dismissed every active alert. They&apos;ll reappear automatically after 24 hours.</p>
          <button onClick={showAllAlerts} className="btn btn-sm btn-secondary">Show all</button>
        </div>
      )}

      {/* Summary Row */}
      {visibleAlerts.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label:'Critical', count:errors.length, color:'text-red-500', bg:'bg-red-50 dark:bg-red-900/20', Icon:XCircle },
            { label:'Warnings', count:warnings.length, color:'text-amber-600', bg:'bg-amber-50 dark:bg-amber-900/20', Icon:AlertTriangle },
            { label:'Info', count:infos.length, color:'text-blue-600', bg:'bg-blue-50 dark:bg-blue-900/20', Icon:Info },
          ].map(item => (
            <div key={item.label} className={`card card-p ${item.bg}`}>
              <div className="flex items-center gap-2">
                <item.Icon size={18} className={item.color}/>
                <span className="text-sm font-medium" style={{ color:'var(--text-secondary)' }}>{item.label}</span>
              </div>
              <p className={`text-2xl font-bold mt-1 ${item.color}`}>{item.count}</p>
            </div>
          ))}
        </div>
      )}

      {/* Alert List */}
      <div className="space-y-3">
        {visibleAlerts.map(alert => {
          const Icon = SEVERITY_ICON[alert.severity];
          return (
            <div key={alert.id} className={`card border p-4 ${SEVERITY_STYLE[alert.severity]}`}>
              <div className="flex items-start gap-3">
                <Icon size={18} className="flex-shrink-0 mt-0.5"/>
                <div className="flex-1">
                  <p className="font-semibold text-sm">{alert.title}</p>
                  <p className="text-sm mt-0.5 opacity-80">{alert.message}</p>
                  {alert.actionable && alert.action_link && (
                    <Link href={alert.action_link} className="inline-block mt-2 text-xs font-medium underline underline-offset-2 opacity-80 hover:opacity-100">
                      {alert.action_label ?? 'Take Action'} →
                    </Link>
                  )}
                </div>
                <button
                  onClick={() => dismissAlert(alert.id)}
                  aria-label="Dismiss alert"
                  className="flex-shrink-0 -mt-1 -mr-1 p-1 rounded opacity-50 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 transition-opacity"
                >
                  <X size={16}/>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Financial Health Checklist */}
      <div className="card card-p">
        <h3 className="section-title text-base mb-4">Financial Health Checklist</h3>
        <div className="space-y-3">
          {[
            { label:'All accounts have initial balances set', check: accounts.length > 0 && transactions.some(t => t.type==='initial_balance'), link:'/dashboard/transactions' },
            { label:'Budgets set for all expense categories', check: budgets.length > 0, link:'/dashboard/budget' },
            { label:'At least one savings account configured', check: accounts.some(a => a.include_in_goal_savings), link:'/dashboard/settings' },
            { label:'Income recorded for this month', check: income.some(i => i.date.startsWith(`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`)), link:'/dashboard/income' },
            { label:'No credit cards with very high outstanding (>₹50K)', check: !balances.some(b => b.is_credit_card && (b.outstanding??0) > 50000), link:'/dashboard/transactions' },
            { label:'Goals configured for future planning', check: true, link:'/dashboard/goals' },
          ].map((item, i) => (
            <div key={i} className="flex items-center gap-3 py-1.5">
              {item.check
                ? <CheckCircle size={16} className="text-emerald-500 flex-shrink-0"/>
                : <XCircle size={16} className="text-red-400 flex-shrink-0"/>}
              <span className={`text-sm flex-1 ${item.check ? '' : 'text-red-600 dark:text-red-400'}`}>{item.label}</span>
              {!item.check && (
                <Link href={item.link} className="text-xs text-blue-600 hover:underline flex-shrink-0">Fix →</Link>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
