'use client';
import { useState, useMemo } from 'react';
import { useAppStore } from '@/lib/store/appStore';
import { calculateAccountBalances, calculateBudgetStatus, getCategorySpend, formatCurrency, accountRole } from '@/lib/utils/calculations';
import { format, endOfMonth } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LineChart, Line, PieChart, Pie, Cell, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { Download, Calendar, TrendingUp, TrendingDown, Wallet } from 'lucide-react';
import Papa from 'papaparse';
import toast from 'react-hot-toast';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default function ReportsPage() {
  const { income, transactions, accounts, budgets, fixedExpenses, settings } = useAppStore();
  const [tab, setTab] = useState<'monthly'|'yearly'|'custom'>('monthly');
  const [trendCategory, setTrendCategory] = useState<string>('');
  const [selMonth, setSelMonth] = useState(new Date().getMonth() + 1);
  const [selYear, setSelYear] = useState(new Date().getFullYear());
  const [startDate, setStartDate] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const sym = settings?.currency_symbol ?? '₹';

  // --- Monthly Data ---
  const monthlyIncome = useMemo(() => {
    const s = `${selYear}-${String(selMonth).padStart(2,'0')}-01`;
    const e = format(endOfMonth(new Date(selYear, selMonth - 1)), 'yyyy-MM-dd');
    return income.filter(i => i.date >= s && i.date <= e);
  }, [income, selMonth, selYear]);

  const monthlyTx = useMemo(() => {
    const s = `${selYear}-${String(selMonth).padStart(2,'0')}-01`;
    const e = format(endOfMonth(new Date(selYear, selMonth - 1)), 'yyyy-MM-dd');
    return transactions.filter(t => t.date >= s && t.date <= e);
  }, [transactions, selMonth, selYear]);

  const monthlyStats = useMemo(() => {
    const totalIncome = monthlyIncome.reduce((s,i) => s+i.amount, 0);
    const trueIncome = monthlyIncome.filter(i => i.include_in_true_income).reduce((s,i) => s+i.amount, 0);
    const expenses = monthlyTx.filter(t => t.type==='expense');
    const totalExpense = expenses.reduce((s,t) => s+t.amount, 0);
    // Use same family detection logic as calculateDashboardKPIs: account-role first,
    // then owner_purpose regex fallback — so both pages always show the same split.
    const familyAcctIds = new Set(accounts.filter(a => accountRole(a) === 'family').map(a => a.id));
    const isFamilyExpense = (t: typeof expenses[0]) =>
      (!!t.from_account_id && familyAcctIds.has(t.from_account_id)) ||
      /family|shared|home|joint/i.test(t.owner_purpose ?? '');
    const familyExpense = expenses.filter(isFamilyExpense).reduce((s,t) => s+t.amount, 0);
    const personalExpense = expenses.filter(t => !isFamilyExpense(t)).reduce((s,t) => s+t.amount, 0);
    const totalSavings = monthlyTx.filter(t => t.type==='saving').reduce((s,t) => s+t.amount, 0);
    const ccBillsPaid = monthlyTx.filter(t => t.type==='credit_card_payment').reduce((s,t) => s+t.amount, 0);
    const netCashflow = totalIncome - totalExpense - totalSavings;
    return { totalIncome, trueIncome, totalExpense, personalExpense, familyExpense, totalSavings, ccBillsPaid, netCashflow };
  }, [monthlyIncome, monthlyTx, accounts]);

  const monthCatSpend = useMemo(() => getCategorySpend(monthlyTx, []), [monthlyTx]);
  const budgetStatuses = useMemo(() => calculateBudgetStatus(budgets, transactions, fixedExpenses, new Date(), selMonth, selYear), [budgets, transactions, fixedExpenses, selMonth, selYear]);
  const balances = useMemo(() => calculateAccountBalances(accounts, income, transactions), [accounts, income, transactions]);

  // --- Yearly Data ---
  const yearlyIncome = useMemo(() => income.filter(i => i.date.startsWith(String(selYear))), [income, selYear]);
  const yearlyTx = useMemo(() => transactions.filter(t => t.date.startsWith(String(selYear))), [transactions, selYear]);
  const yearlyStats = useMemo(() => {
    const totalIncome = yearlyIncome.reduce((s,i) => s+i.amount, 0);
    const expenses = yearlyTx.filter(t => t.type==='expense');
    const totalExpense = expenses.reduce((s,t) => s+t.amount, 0);
    const totalSavings = yearlyTx.filter(t => t.type==='saving').reduce((s,t) => s+t.amount, 0);
    const ccBills = yearlyTx.filter(t => t.type==='credit_card_payment').reduce((s,t) => s+t.amount, 0);
    // Same account-role + regex logic as calculateDashboardKPIs
    const familyAcctIds = new Set(accounts.filter(a => accountRole(a) === 'family').map(a => a.id));
    const familyExpense = expenses.filter(t =>
      (!!t.from_account_id && familyAcctIds.has(t.from_account_id)) ||
      /family|shared|home|joint/i.test(t.owner_purpose ?? '')
    ).reduce((s,t) => s+t.amount, 0);
    return { totalIncome, totalExpense, totalSavings, ccBills, familyExpense };
  }, [yearlyIncome, yearlyTx, accounts]);

  const trends = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const m = i + 1;
      const start = `${selYear}-${String(m).padStart(2,'0')}-01`;
      const end = format(endOfMonth(new Date(selYear, i)), 'yyyy-MM-dd');
      const mIncome = income.filter(x => x.date >= start && x.date <= end).reduce((s,x) => s+x.amount, 0);
      const mExpense = transactions.filter(t => t.type==='expense' && t.date >= start && t.date <= end).reduce((s,t) => s+t.amount, 0);
      const mSavings = transactions.filter(t => t.type==='saving' && t.date >= start && t.date <= end).reduce((s,t) => s+t.amount, 0);
      return { month: MONTHS[i], year: selYear, income: mIncome, expense: mExpense, savings: mSavings, net: mIncome - mExpense - mSavings };
    });
  }, [income, transactions, selYear]);
  const yearlyCatSpend = useMemo(() => getCategorySpend(yearlyTx.filter(t => t.type==='expense'), []), [yearlyTx]);

  const categoryTrendData = useMemo(() => {
    if (!trendCategory) return [];
    const now = new Date();
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
      const y = d.getFullYear(); const m = d.getMonth() + 1;
      const start = `${y}-${String(m).padStart(2,'0')}-01`;
      const end = format(endOfMonth(d), 'yyyy-MM-dd');
      const amount = transactions.filter(t => t.type==='expense' && t.category===trendCategory && t.date>=start && t.date<=end).reduce((s,t) => s+t.amount, 0);
      return { month: format(d,'MMM yy'), amount };
    });
  }, [trendCategory, transactions]);

  const bestSavingMonth = useMemo(() => {
    const m = trends.reduce((best, t) => t.savings > best.savings ? t : best, { savings:0, month:'—' });
    return m.month;
  }, [trends]);
  const worstSpendMonth = useMemo(() => {
    const m = trends.reduce((worst, t) => t.expense > worst.expense ? t : worst, { expense:0, month:'—' });
    return m.month;
  }, [trends]);

  // --- Custom Date Range ---
  const customIncome = useMemo(() => income.filter(i => i.date >= startDate && i.date <= endDate), [income, startDate, endDate]);
  const customTx = useMemo(() => transactions.filter(t => t.date >= startDate && t.date <= endDate), [transactions, startDate, endDate]);
  const customStats = useMemo(() => {
    const totalIncome = customIncome.reduce((s,i) => s+i.amount, 0);
    const expenses = customTx.filter(t => t.type==='expense');
    const totalExpense = expenses.reduce((s,t) => s+t.amount, 0);
    const totalSavings = customTx.filter(t => t.type==='saving').reduce((s,t) => s+t.amount, 0);
    const ccBills = customTx.filter(t => t.type==='credit_card_payment').reduce((s,t) => s+t.amount, 0);
    const netCashflow = totalIncome - totalExpense - totalSavings;
    return { totalIncome, totalExpense, totalSavings, ccBills, netCashflow };
  }, [customIncome, customTx]);

  const exportCSV = () => {
    const rows = tab === 'monthly'
      ? monthlyTx.map(t => ({ date:t.date, type:t.type, category:t.category, owner:t.owner_purpose, amount:t.amount, description:t.description }))
      : tab === 'yearly'
        ? yearlyTx.map(t => ({ date:t.date, type:t.type, category:t.category, owner:t.owner_purpose, amount:t.amount }))
        : customTx.map(t => ({ date:t.date, type:t.type, category:t.category, amount:t.amount }));
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type:'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=`mcs-report-${tab}.csv`; a.click();
    toast.success('Report exported');
  };

  const StatRow = ({ label, value, sub, color='text-slate-700 dark:text-slate-200' }: any) => (
    <div className="flex items-center justify-between py-2.5 border-b border-slate-100 dark:border-slate-700 last:border-0">
      <span className="text-sm" style={{ color:'var(--text-secondary)' }}>{label}</span>
      <div className="text-right">
        <span className={`text-sm font-semibold ${color}`}>{formatCurrency(value, sym)}</span>
        {sub && <p className="text-xs" style={{ color:'var(--text-muted)' }}>{sub}</p>}
      </div>
    </div>
  );

  const COLORS = ['#3b82f6','#22c55e','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#14b8a6','#f97316','#6366f1'];

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="text-sm" style={{ color:'var(--text-secondary)' }}>Monthly, yearly and custom date range analysis</p>
        </div>
        <button onClick={exportCSV} className="btn-md btn-secondary"><Download size={16}/> Export CSV</button>
      </div>

      {/* Tab Switcher */}
      <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl w-fit">
        {(['monthly','yearly','custom'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${tab===t ? 'bg-white dark:bg-slate-700 shadow-sm text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>
            {t.charAt(0).toUpperCase()+t.slice(1)}
          </button>
        ))}
      </div>

      {/* Monthly Report */}
      {tab==='monthly' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <select className="form-select text-sm py-1.5 px-3 w-auto" value={selMonth} onChange={e => setSelMonth(+e.target.value)}>
              {MONTHS.map((m,i) => <option key={m} value={i+1}>{m}</option>)}
            </select>
            <select className="form-select text-sm py-1.5 px-3 w-auto" value={selYear} onChange={e => setSelYear(+e.target.value)}>
              {[2024,2025,2026,2027].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Summary */}
            <div className="card card-p">
              <h3 className="section-title text-base mb-3">P&L Summary — {MONTHS[selMonth-1]} {selYear}</h3>
              <StatRow label="Total Income" value={monthlyStats.totalIncome} color="text-emerald-600 dark:text-emerald-400" />
              <StatRow label="True Income" value={monthlyStats.trueIncome} sub="Excl. family/reimbursements" color="text-emerald-600 dark:text-emerald-400" />
              <StatRow label="Total Expense" value={monthlyStats.totalExpense} color="text-red-500" />
              <StatRow label="Personal Expense" value={monthlyStats.personalExpense} sub="Your own spending" color="text-orange-500" />
              <StatRow label="Family Expense" value={monthlyStats.familyExpense} sub="Home & shared spending" color="text-amber-600" />
              <StatRow label="Savings Moved" value={monthlyStats.totalSavings} color="text-blue-600 dark:text-blue-400" />
              <StatRow label="CC Bills Paid" value={monthlyStats.ccBillsPaid} color="text-indigo-600 dark:text-indigo-400" />
              <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                <StatRow label="Net Cashflow" value={monthlyStats.netCashflow} color={monthlyStats.netCashflow >= 0 ? 'text-emerald-600' : 'text-red-500'} />
              </div>
            </div>

            {/* Category Pie */}
            <div className="card card-p">
              <h3 className="section-title text-base mb-3">Expense by Category</h3>
              {monthCatSpend.length === 0
                ? <p className="text-sm text-center py-8" style={{ color:'var(--text-muted)' }}>No expenses this month</p>
                : <>
                  <ResponsiveContainer width="100%" height={150}>
                    <PieChart>
                      <Pie data={monthCatSpend.slice(0,8)} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="amount" paddingAngle={2}>
                        {monthCatSpend.slice(0,8).map((_,i) => <Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
                      </Pie>
                      <Tooltip formatter={(v:number) => [formatCurrency(v,sym),'']} contentStyle={{ borderRadius:'10px',border:'none',fontSize:11 }}/>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-1 mt-2 max-h-32 overflow-y-auto">
                    {monthCatSpend.slice(0,8).map((c,i) => (
                      <div key={c.category} className="flex items-center gap-2 text-xs">
                        <span className="w-2 h-2 rounded-full" style={{ background:COLORS[i%COLORS.length]}}/>
                        <span className="flex-1 truncate" style={{ color:'var(--text-secondary)' }}>{c.category}</span>
                        <span className="font-medium">{formatCurrency(c.amount,sym)}</span>
                        <span style={{ color:'var(--text-muted)' }}>{c.percent.toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                </>
              }
            </div>

            {/* Budget Variance */}
            <div className="card card-p">
              <h3 className="section-title text-base mb-3">Budget Variance</h3>
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {budgetStatuses.length===0 && <p className="text-sm text-center py-4" style={{ color:'var(--text-muted)' }}>No budgets set</p>}
                {budgetStatuses.map(bs => (
                  <div key={bs.category} className="flex items-center gap-2 text-xs">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${bs.status==='green'?'bg-emerald-500':bs.status==='red'?'bg-red-500':'bg-amber-500'}`}/>
                    <span className="flex-1 truncate" style={{ color:'var(--text-secondary)' }}>{bs.category}</span>
                    <span className={`font-medium ${bs.remaining_monthly<0?'text-red-500':'text-emerald-600'}`}>
                      {bs.remaining_monthly>=0 ? `+${formatCurrency(bs.remaining_monthly,sym)}` : formatCurrency(bs.remaining_monthly,sym)} left
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Closing Balances */}
          <div className="card card-p">
            <h3 className="section-title text-base mb-3">Closing Balances (All Time)</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {balances.filter(b => b.account.is_active && b.account.include_in_dashboard).map(b => (
                <div key={b.account.id} className="card card-p !p-3">
                  <p className="text-xs truncate" style={{ color:'var(--text-muted)' }}>{b.account.name}</p>
                  <p className={`text-sm font-bold mt-0.5 ${b.is_credit_card ? (b.outstanding??0)>0?'amount-negative':'text-slate-400' : b.balance>=0?'amount-positive':'amount-negative'}`}>
                    {b.is_credit_card ? `-${formatCurrency(b.outstanding??0,sym)}` : formatCurrency(b.balance,sym)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Yearly Report */}
      {tab==='yearly' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <select className="form-select text-sm py-1.5 px-3 w-auto" value={selYear} onChange={e => setSelYear(+e.target.value)}>
              {[2023,2024,2025,2026,2027].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label:'Total Income', value:yearlyStats.totalIncome, color:'text-emerald-600' },
              { label:'Total Expense', value:yearlyStats.totalExpense, color:'text-red-500' },
              { label:'Total Savings', value:yearlyStats.totalSavings, color:'text-blue-600' },
              { label:'CC Bills Paid', value:yearlyStats.ccBills, color:'text-indigo-600' },
              { label:'Family Expense', value:yearlyStats.familyExpense, color:'text-amber-600' },
            ].map(item => (
              <div key={item.label} className="card card-p">
                <p className="kpi-label">{item.label}</p>
                <p className={`kpi-value mt-1 ${item.color}`}>{formatCurrency(item.value, sym)}</p>
              </div>
            ))}
          </div>

          {/* Category Trend Chart */}
          <div className="card card-p">
            <div className="flex items-center justify-between mb-4">
              <h3 className="section-title text-base">Category Spend Trend</h3>
              <select className="form-select text-sm py-1.5 px-3 w-auto" value={trendCategory} onChange={e => setTrendCategory(e.target.value)}>
                <option value="">Select category…</option>
                {Array.from(new Set(transactions.filter(t => t.type==='expense' && t.category).map(t => t.category!))).sort().map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            {!trendCategory ? (
              <p className="text-sm text-center py-6" style={{ color: 'var(--text-muted)' }}>Select a category above to see its 12-month spend trend</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={categoryTrendData} margin={{ top:5,right:10,left:0,bottom:0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" vertical={false}/>
                  <XAxis dataKey="month" tick={{ fontSize:11, fill:'var(--text-muted)' }} axisLine={false} tickLine={false}/>
                  <YAxis tick={{ fontSize:11, fill:'var(--text-muted)' }} axisLine={false} tickLine={false} tickFormatter={v=>`${sym}${(v/1000).toFixed(0)}K`}/>
                  <Tooltip formatter={(v:number) => [formatCurrency(v,sym), trendCategory]} contentStyle={{ borderRadius:'10px',border:'none',fontSize:12 }}/>
                  <Line type="monotone" dataKey="amount" stroke="#3b82f6" strokeWidth={2} dot={{ r:3 }} activeDot={{ r:5 }}/>
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Monthly Trend Chart */}
            <div className="card card-p">
              <h3 className="section-title text-base mb-4">Monthly Trend — {selYear}</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={trends} margin={{ top:5,right:10,left:0,bottom:0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" vertical={false}/>
                  <XAxis dataKey="month" tick={{ fontSize:11, fill:'var(--text-muted)' }} axisLine={false} tickLine={false}/>
                  <YAxis tick={{ fontSize:11, fill:'var(--text-muted)' }} axisLine={false} tickLine={false} tickFormatter={v=>`${sym}${(v/1000).toFixed(0)}K`}/>
                  <Tooltip formatter={(v:number,n:string) => [formatCurrency(v,sym), n]} contentStyle={{ borderRadius:'10px',border:'none',boxShadow:'var(--shadow-lg)',fontSize:12 }}/>
                  <Legend wrapperStyle={{ fontSize:12 }}/>
                  <Bar dataKey="income" name="Income" fill="#22c55e" radius={[4,4,0,0]}/>
                  <Bar dataKey="expense" name="Expense" fill="#ef4444" radius={[4,4,0,0]}/>
                  <Bar dataKey="savings" name="Savings" fill="#3b82f6" radius={[4,4,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
              <div className="flex gap-4 text-xs mt-2">
                <span>Best saving month: <strong className="text-emerald-600">{bestSavingMonth}</strong></span>
                <span>Worst spending month: <strong className="text-red-500">{worstSpendMonth}</strong></span>
              </div>
            </div>

            {/* Annual Category Pie */}
            <div className="card card-p">
              <h3 className="section-title text-base mb-4">Annual Category Spend — {selYear}</h3>
              {yearlyCatSpend.length===0
                ? <p className="text-sm text-center py-8" style={{ color:'var(--text-muted)' }}>No data for {selYear}</p>
                : <><ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie data={yearlyCatSpend.slice(0,8)} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="amount" paddingAngle={2}>
                        {yearlyCatSpend.slice(0,8).map((_,i) => <Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
                      </Pie>
                      <Tooltip formatter={(v:number) => [formatCurrency(v,sym),'']} contentStyle={{ borderRadius:'10px',border:'none',fontSize:11 }}/>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto">
                    {yearlyCatSpend.slice(0,8).map((c,i) => (
                      <div key={c.category} className="flex items-center gap-2 text-xs">
                        <span className="w-2 h-2 rounded-full" style={{ background:COLORS[i%COLORS.length]}}/>
                        <span className="flex-1 truncate" style={{ color:'var(--text-secondary)' }}>{c.category}</span>
                        <span className="font-semibold">{formatCurrency(c.amount,sym)}</span>
                        <span style={{ color:'var(--text-muted)' }}>{c.percent.toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                </>
              }
            </div>
          </div>
        </div>
      )}

      {/* Custom Range */}
      {tab==='custom' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="form-group">
              <label className="form-label">From</label>
              <input type="date" className="form-input text-sm py-1.5" value={startDate} onChange={e => setStartDate(e.target.value)}/>
            </div>
            <div className="form-group">
              <label className="form-label">To</label>
              <input type="date" className="form-input text-sm py-1.5" value={endDate} onChange={e => setEndDate(e.target.value)}/>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label:'Income', value:customStats.totalIncome, color:'text-emerald-600' },
              { label:'Expense', value:customStats.totalExpense, color:'text-red-500' },
              { label:'Savings', value:customStats.totalSavings, color:'text-blue-600' },
              { label:'CC Bills', value:customStats.ccBills, color:'text-indigo-600' },
              { label:'Net Cashflow', value:customStats.netCashflow, color:customStats.netCashflow>=0?'text-emerald-600':'text-red-500' },
            ].map(item => (
              <div key={item.label} className="card card-p">
                <p className="kpi-label">{item.label}</p>
                <p className={`kpi-value mt-1 ${item.color}`}>{formatCurrency(item.value, sym)}</p>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="table-container border-0">
              <table className="data-table">
                <thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Description</th><th>Owner</th><th className="text-right">Amount</th></tr></thead>
                <tbody>
                  {customTx.length===0 && customIncome.length===0 && (
                    <tr><td colSpan={6} className="text-center py-8 text-sm" style={{ color:'var(--text-muted)' }}>No transactions in this date range</td></tr>
                  )}
                  {customTx.map(t => (
                    <tr key={t.id}>
                      <td className="text-xs">{t.date}</td>
                      <td><span className={`badge text-[10px] ${t.type==='expense'?'badge-red':t.type==='saving'?'badge-blue':'badge-gray'}`}>{t.type.replace(/_/g,' ')}</span></td>
                      <td className="text-xs">{t.category??'—'}</td>
                      <td className="text-xs">{t.description??'—'}</td>
                      <td className="text-xs">{t.owner_purpose??'—'}</td>
                      <td className={`text-right text-sm font-semibold ${t.type==='expense'?'amount-negative':t.type==='saving'?'text-blue-600':'amount-neutral'}`}>
                        {t.type==='expense'?'-':''}{formatCurrency(t.amount,sym)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
