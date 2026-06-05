'use client';
import { useMemo, useState, useEffect } from 'react';
import { useAppStore } from '@/lib/store/appStore';
import {
  calculateAccountBalances, calculateDashboardKPIs, calculateBudgetStatus,
  buildMonthlyTrends, getCategorySpend, generateAlerts, formatCurrency
} from '@/lib/utils/calculations';
import { runAutoProcess } from '@/lib/utils/autoProcess';
import { createClient } from '@/lib/supabase/client';
import toast from 'react-hot-toast';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import {
  Wallet, TrendingUp, TrendingDown, CreditCard, Shield, Target,
  Calendar, ChevronDown, RefreshCw, AlertTriangle, ArrowUp, ArrowDown
} from 'lucide-react';
import Link from 'next/link';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Runs the recurring catch-up once per app load (module-scoped guard).
let dashboardAutoRan = false;

export default function DashboardPage() {
  const { accounts, income, transactions, fixedExpenses, budgets, goals, categories, settings, dateFilter, setDateFilter, isLoading } = useAppStore();

  const now = new Date();
  const [selMonth, setSelMonth] = useState(dateFilter.month ?? now.getMonth() + 1);
  const [selYear, setSelYear] = useState(dateFilter.year ?? now.getFullYear());

  const filter = { ...dateFilter, month: selMonth, year: selYear };

  const balances = useMemo(() => calculateAccountBalances(accounts, income, transactions), [accounts, income, transactions]);
  const kpis = useMemo(() => settings ? calculateDashboardKPIs(accounts, income, transactions, fixedExpenses, filter, settings) : null, [accounts, income, transactions, fixedExpenses, filter, settings]);
  const budgetStatus = useMemo(() => calculateBudgetStatus(budgets, transactions, income, fixedExpenses, now, selMonth, selYear), [budgets, transactions, income, fixedExpenses, selMonth, selYear]);
  const trends = useMemo(() => buildMonthlyTrends(income, transactions, 12), [income, transactions]);
  const catSpend = useMemo(() => getCategorySpend(
    transactions.filter(t => { const start = `${selYear}-${String(selMonth).padStart(2,'0')}-01`; const end = `${selYear}-${String(selMonth).padStart(2,'0')}-31`; return t.date >= start && t.date <= end; }),
    categories.map(c => ({ name: c.name, color: c.color }))
  ), [transactions, selMonth, selYear, categories]);

  const activeAlerts = useMemo(() => generateAlerts(budgetStatus, balances, fixedExpenses, settings ?? { safe_spend_buffer: 5000 } as any), [budgetStatus, balances, fixedExpenses, settings]);

  const sym = settings?.currency_symbol ?? '₹';

  // Auto-post any due fixed expenses as soon as data is loaded.
  useEffect(() => {
    if (isLoading || dashboardAutoRan || fixedExpenses.length === 0) return;
    dashboardAutoRan = true;
    (async () => {
      try {
        const sb = createClient();
        const { data: { user } } = await sb.auth.getUser();
        if (!user) return;
        const state = useAppStore.getState();
        const res = await runAutoProcess({
          userId: user.id,
          fixedExpenses: state.fixedExpenses,
          transactions: state.transactions,
          sb,
          addTransaction: state.addTransaction,
          updateFixedExpense: state.updateFixedExpense,
          asOf: new Date(),
        });
        if (res.created > 0) {
          toast.success(`Auto-posted ${res.created} recurring entr${res.created === 1 ? 'y' : 'ies'} · ${formatCurrency(res.totalAmount, sym)}`);
        }
      } catch { /* stay silent on load */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, fixedExpenses.length]);

  if (isLoading) return <LoadingSkeleton />;

  const KPICard = ({ label, value, sub, icon: Icon, color, prefix, trend }: any) => (
    <div className="kpi-card group animate-fade-in-up">
      <div className="flex items-start justify-between mb-2">
        <span className="kpi-label">{label}</span>
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${color}`}>
          <Icon size={18} />
        </div>
      </div>
      <div className={`kpi-value ${prefix === '-' ? 'amount-negative' : prefix === '+' ? 'amount-positive' : 'amount-neutral'}`}>
        {prefix && prefix !== '-' ? prefix : ''}{formatCurrency(value, sym)}
      </div>
      {sub && <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
      {trend !== undefined && (
        <div className={`flex items-center gap-1 text-xs mt-1 font-medium ${trend >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
          {trend >= 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
          {Math.abs(trend).toFixed(1)}% vs last month
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Financial overview — {MONTHS[selMonth - 1]} {selYear}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Month selector */}
          <select
            className="form-select text-sm py-2 px-3 pr-8 w-auto"
            value={selMonth}
            onChange={e => { setSelMonth(+e.target.value); setDateFilter({ ...filter, month: +e.target.value }); }}
          >
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select
            className="form-select text-sm py-2 px-3 pr-8 w-auto"
            value={selYear}
            onChange={e => { setSelYear(+e.target.value); setDateFilter({ ...filter, year: +e.target.value }); }}
          >
            {[2023, 2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {/* Alerts strip */}
      {activeAlerts.length > 0 && (
        <div className="space-y-2">
          {activeAlerts.slice(0, 3).map(a => (
            <div key={a.id} className={`flex items-center gap-3 p-3 rounded-lg border text-sm ${a.severity === 'error' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-800'} dark:bg-opacity-10`}>
              <AlertTriangle size={16} className="flex-shrink-0" />
              <span className="font-medium">{a.title}:</span> <span>{a.message}</span>
            </div>
          ))}
          {activeAlerts.length > 3 && (
            <Link href="/dashboard/alerts" className="text-sm text-blue-600 hover:underline">
              +{activeAlerts.length - 3} more alerts →
            </Link>
          )}
        </div>
      )}

      {/* KPI Cards Grid */}
      {kpis && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 sm:gap-4">
          <KPICard label="Bank Balance" value={kpis.total_bank_balance} icon={Wallet}
            color="bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
            sub={`${balances.filter(b => !b.is_credit_card && b.account.is_active).length} accounts`} />
          <KPICard label="Spendable" value={kpis.spendable_balance} icon={TrendingUp}
            color="bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400"
            sub="Usable right now" prefix={kpis.spendable_balance >= 0 ? '' : '-'} />
          <KPICard label="Savings" value={kpis.savings_balance} icon={Shield}
            color="bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400"
            sub="Goal savings" />
          <KPICard label="CC Outstanding" value={kpis.total_cc_outstanding} icon={CreditCard}
            color="bg-red-50 dark:bg-red-900/30 text-red-500 dark:text-red-400"
            sub="Total owed on cards" prefix="-" />
          <KPICard label="Income" value={kpis.total_income} icon={TrendingUp}
            color="bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400"
            sub={`True: ${formatCurrency(kpis.true_income, sym)}`} prefix="+" />
          <KPICard label="Expenses" value={kpis.total_expense} icon={TrendingDown}
            color="bg-orange-50 dark:bg-orange-900/30 text-orange-500 dark:text-orange-400"
            sub={`Personal: ${formatCurrency(kpis.personal_expense, sym)}`} prefix="-" />
          <KPICard label="Savings (Period)" value={kpis.total_savings} icon={Target}
            color="bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400"
            sub="Moved to savings" />
          <KPICard label="CC Bills Paid" value={kpis.cc_bills_paid} icon={CreditCard}
            color="bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400"
            sub="This period" />
          <KPICard label="Net Cashflow" value={kpis.net_cashflow} icon={TrendingUp}
            color={kpis.net_cashflow >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}
            sub="Income − Exp − Savings" prefix={kpis.net_cashflow >= 0 ? '+' : '-'} />
          <KPICard label="Safe to Spend" value={kpis.safe_to_spend} icon={Shield}
            color="bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
            sub="After bills & buffer" />
          <KPICard label="Family Expense" value={kpis.family_expense} icon={Wallet}
            color="bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400"
            sub="Home & shared spend" prefix="-" />
          <KPICard label="Upcoming Fixed" value={kpis.upcoming_fixed_expenses} icon={Calendar}
            color="bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
            sub="Fixed payments due" />
        </div>
      )}

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Trend Chart */}
        <div className="lg:col-span-2 card card-p animate-fade-in-up stagger-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="section-title text-base">Income vs Expense vs Savings</h3>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Last 12 months</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={trends} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="expenseGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
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

        {/* Category Spend Pie */}
        <div className="card card-p animate-fade-in-up stagger-3">
          <h3 className="section-title text-base mb-4">Expense by Category</h3>
          {catSpend.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No expenses this month</p>
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={catSpend.slice(0, 8)} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="amount" paddingAngle={2}>
                    {catSpend.slice(0, 8).map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
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

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Account Balances */}
        <div className="card card-p animate-fade-in-up stagger-4">
          <h3 className="section-title text-base mb-4">Account Balances</h3>
          <div className="space-y-3">
            {balances.filter(b => b.account.is_active && b.account.include_in_dashboard).map(b => (
              <div key={b.account.id} className="flex items-center gap-3 py-1">
                <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
                  {b.is_credit_card ? <CreditCard size={15} className="text-red-500" /> : <Wallet size={15} className="text-blue-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{b.account.name}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{b.account.account_type}</p>
                </div>
                <span className={`text-sm font-bold ${b.is_credit_card ? (b.outstanding ?? 0) > 0 ? 'amount-negative' : 'text-slate-400' : b.balance >= 0 ? 'amount-positive' : 'amount-negative'}`}>
                  {b.is_credit_card ? `-${formatCurrency(b.outstanding ?? 0, sym)}` : formatCurrency(b.balance, sym)}
                </span>
              </div>
            ))}
            {balances.filter(b => b.account.is_active && b.account.include_in_dashboard).length === 0 && (
              <p className="text-sm text-center py-6" style={{ color: 'var(--text-muted)' }}>
                No accounts configured. <Link href="/dashboard/settings" className="text-blue-600 hover:underline">Add accounts →</Link>
              </p>
            )}
          </div>
        </div>

        {/* Budget Status */}
        <div className="card card-p animate-fade-in-up stagger-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="section-title text-base">Budget Status</h3>
            <Link href="/dashboard/budget" className="text-xs text-blue-600 hover:underline">View all →</Link>
          </div>
          <div className="space-y-3 max-h-72 overflow-y-auto">
            {budgetStatus.length === 0 && (
              <p className="text-sm text-center py-6" style={{ color: 'var(--text-muted)' }}>
                No budgets set. <Link href="/dashboard/budget" className="text-blue-600 hover:underline">Set budgets →</Link>
              </p>
            )}
            {budgetStatus.map(bs => (
              <div key={bs.category}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{bs.category}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {formatCurrency(bs.actual_till_date, sym)} / {formatCurrency(bs.monthly_budget, sym)}
                    </span>
                    <span className={`badge text-[10px] px-1.5 py-0 ${bs.status === 'green' ? 'badge-green' : bs.status === 'red' ? 'badge-red' : bs.status === 'orange' ? 'badge-yellow' : 'badge-gray'}`}>
                      {bs.status === 'green' ? 'OK' : bs.status === 'red' ? 'Over' : bs.status === 'orange' ? 'Watch' : '—'}
                    </span>
                  </div>
                </div>
                <div className="progress-bar">
                  <div
                    className={`progress-fill ${bs.status === 'green' ? 'bg-emerald-500' : bs.status === 'red' ? 'bg-red-500' : 'bg-amber-500'}`}
                    style={{ width: `${Math.min(100, bs.monthly_budget > 0 ? (bs.actual_till_date / bs.monthly_budget) * 100 : 0)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Transactions */}
      <div className="card animate-fade-in-up stagger-6">
        <div className="flex items-center justify-between p-5 pb-0">
          <h3 className="section-title text-base">Recent Transactions</h3>
          <Link href="/dashboard/transactions" className="text-xs text-blue-600 hover:underline">View all →</Link>
        </div>
        <div className="table-container mt-4 border-0 border-t border-slate-100 dark:border-slate-700 rounded-none rounded-b-xl">
          <table className="data-table">
            <thead><tr>
              <th>Date</th><th>Description</th><th>Category</th><th>Type</th><th className="text-right">Amount</th>
            </tr></thead>
            <tbody>
              {transactions.slice(0, 10).map(tx => (
                <tr key={tx.id}>
                  <td className="text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{tx.date}</td>
                  <td className="max-w-xs"><span className="truncate block" style={{ maxWidth: 200 }}>{tx.description || tx.category || tx.type}</span></td>
                  <td><span className="badge badge-gray text-[10px]">{tx.category ?? '—'}</span></td>
                  <td><span className={`badge text-[10px] ${tx.type === 'expense' ? 'badge-red' : tx.type === 'saving' ? 'badge-blue' : tx.type === 'credit_card_payment' ? 'badge-yellow' : 'badge-gray'}`}>{tx.type.replace(/_/g, ' ')}</span></td>
                  <td className={`text-right font-semibold text-sm ${tx.type === 'expense' ? 'amount-negative' : tx.type === 'saving' ? 'text-blue-600' : 'amount-positive'}`}>
                    {tx.type === 'expense' ? '-' : ''}{formatCurrency(tx.amount, sym)}
                  </td>
                </tr>
              ))}
              {transactions.length === 0 && (
                <tr><td colSpan={5} className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>
                  No transactions yet. <Link href="/dashboard/transactions" className="text-blue-600 hover:underline">Add one →</Link>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="skeleton h-8 w-48 rounded-lg" />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[...Array(12)].map((_, i) => <div key={i} className="skeleton h-24 rounded-xl" />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 skeleton h-64 rounded-xl" />
        <div className="skeleton h-64 rounded-xl" />
      </div>
    </div>
  );
}
