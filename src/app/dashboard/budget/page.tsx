'use client';
import { useState, useMemo } from 'react';
import { useAppStore } from '@/lib/store/appStore';
import { createClient } from '@/lib/supabase/client';
import { Budget } from '@/types';
import { calculateBudgetStatus, formatCurrency, currencySymbol, convertAmount, normalizeAmounts, YEAR_OPTIONS } from '@/lib/utils/calculations';
import { useDisplayCurrency } from '@/lib/useDisplayCurrency';
import { getDaysInMonth } from 'date-fns';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, X, Check, TrendingUp, AlertTriangle, CheckCircle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useConfirm } from '@/components/ConfirmDialog';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default function BudgetPage() {
  const { budgets, categories, owners, accounts, transactions, fixedExpenses, addBudget, updateBudget, removeBudget, settings } = useAppStore();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Budget | null>(null);
  const [form, setForm] = useState({ category: '', owner_purpose: '', monthly_budget: 0, include_in_budget: true, notes: '' });
  const [saving, setSaving] = useState(false);
  const [selMonth, setSelMonth] = useState(new Date().getMonth() + 1);
  const [selYear, setSelYear] = useState(new Date().getFullYear());
  const sb = createClient();
  const confirm = useConfirm();
  const today = new Date();

  // ---- Multi-currency wiring ----
  // Budgets and fixed expenses are stored in the BASE currency / their native
  // account currency. To display and compare everything in the chosen display
  // currency we convert budgets (base -> display), convert fixed-expense
  // amounts (their from-account's native currency -> display) and feed
  // display-normalized transactions into calculateBudgetStatus — so every
  // derived figure comes back already in the display currency. When
  // display === base (or rates are missing) all conversions are no-ops.
  const base = settings?.currency ?? 'INR';
  const rates = settings?.exchange_rates;
  const [displayCur] = useDisplayCurrency(base);
  const sym = currencySymbol(displayCur);

  const norm = useMemo(
    () => normalizeAmounts(accounts, [], transactions, rates, base, displayCur),
    [accounts, transactions, rates, base, displayCur]
  );
  const displayBudgets = useMemo(
    () => budgets.map(b => ({ ...b, monthly_budget: convertAmount(b.monthly_budget, base, displayCur, rates, base) })),
    [budgets, base, displayCur, rates]
  );
  const displayFixedExpenses = useMemo(() => {
    const curOf = new Map(accounts.map(a => [a.id, a.currency || base]));
    return fixedExpenses.map(fe => ({
      ...fe,
      amount: convertAmount(fe.amount, (fe.from_account_id && curOf.get(fe.from_account_id)) || base, displayCur, rates, base),
    }));
  }, [fixedExpenses, accounts, base, displayCur, rates]);

  const expenseCategories = useMemo(() => categories.filter(c => (c.type === 'expense' || c.type === 'all') && c.is_active && c.include_in_budget), [categories]);
  const activeOwners = useMemo(() => owners.filter(o => o.is_active), [owners]);

  const statusDate = useMemo(() => {
    if (selMonth === today.getMonth() + 1 && selYear === today.getFullYear()) return today;
    const lastDay = new Date(selYear, selMonth, 0);
    return lastDay;
  }, [selMonth, selYear, today]);

  const budgetStatuses = useMemo(() =>
    calculateBudgetStatus(displayBudgets, norm.transactions, displayFixedExpenses, statusDate, selMonth, selYear),
    [displayBudgets, norm.transactions, displayFixedExpenses, statusDate, selMonth, selYear]
  );

  const summary = useMemo(() => ({
    totalBudget: budgetStatuses.reduce((s, b) => s + b.monthly_budget, 0),
    totalActual: budgetStatuses.reduce((s, b) => s + b.actual_till_date, 0),
    overCount: budgetStatuses.filter(b => b.status === 'red').length,
    onTrack: budgetStatuses.filter(b => b.status === 'green').length,
    projectedOverCount: budgetStatuses.filter(b => b.monthly_budget > 0 && b.projected_month_end > b.monthly_budget).length,
  }), [budgetStatuses]);

  const chartData = useMemo(() =>
    budgetStatuses.filter(b => b.monthly_budget > 0).map(b => ({
      name: b.category.length > 12 ? b.category.slice(0, 12) + '…' : b.category,
      budget: b.monthly_budget, actual: b.actual_till_date,
      status: b.status,
    })).sort((a, b) => b.actual - a.actual).slice(0, 12),
    [budgetStatuses]
  );

  const openNew = () => {
    const usedCats = new Set(budgets.map(b => b.category));
    const firstUnused = expenseCategories.find(c => !usedCats.has(c.name));
    setEditing(null);
    setForm({ category: firstUnused?.name ?? expenseCategories[0]?.name ?? '', owner_purpose: '', monthly_budget: 0, include_in_budget: true, notes: '' });
    setShowForm(true);
  };
  const openEdit = (b: Budget) => {
    setEditing(b);
    setForm({ category: b.category, owner_purpose: b.owner_purpose ?? '', monthly_budget: b.monthly_budget, include_in_budget: b.include_in_budget, notes: b.notes ?? '' });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.category || !(form.monthly_budget > 0)) { toast.error('Enter a category and a budget greater than 0'); return; }
    setSaving(true);
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      const payload = { ...form, monthly_budget: +form.monthly_budget, user_id: user.id };
      if (editing) {
        const { data, error } = await sb.from('budget').update(payload).eq('id', editing.id).select().single();
        if (error) throw error;
        updateBudget(editing.id, data);
        toast.success('Budget updated');
      } else {
        const existing = budgets.find(b => b.category === form.category);
        if (existing) { toast.error('Budget for this category already exists. Edit it instead.'); setSaving(false); return; }
        const { data, error } = await sb.from('budget').insert(payload).select().single();
        if (error) throw error;
        addBudget(data);
        toast.success('Budget added');
      }
      setShowForm(false);
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  const handleDelete = async (b: Budget) => {
    if (!(await confirm({ title:'Delete budget?', message:`Delete budget for "${b.category}"?`, confirmLabel:'Delete', danger:true }))) return;
    try {
      const { error } = await sb.from('budget').delete().eq('id', b.id);
      if (error) throw error;
      removeBudget(b.id);
      toast.success('Budget removed');
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Budget</h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Category-wise monthly limits and spending status</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="form-select text-sm py-1.5 px-3 w-auto" value={selMonth} onChange={e => setSelMonth(+e.target.value)}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select className="form-select text-sm py-1.5 px-3 w-auto" value={selYear} onChange={e => setSelYear(+e.target.value)}>
            {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={openNew} className="btn-md btn-primary"><Plus size={16}/> Add Budget</button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label: 'Total Budget', value: summary.totalBudget, badge: null, color: '#6366f1' },
          { label: 'Total Actual', value: summary.totalActual, badge: null, color: summary.totalActual > summary.totalBudget ? '#ef4444' : '#10b981' },
          { label: 'Over Budget', value: null, badge: summary.overCount, color: '#ef4444' },
          { label: 'On Track', value: null, badge: summary.onTrack, color: '#10b981' },
          { label: 'Projected Over Budget', value: null, badge: summary.projectedOverCount, color: summary.projectedOverCount > 0 ? '#ef4444' : '#10b981' },
        ].map(item => (
          <div
            key={item.label}
            className="card card-p relative overflow-hidden min-w-0"
            style={{
              background: `color-mix(in srgb, ${item.color} 12%, var(--bg-surface))`,
              borderColor: `color-mix(in srgb, ${item.color} 28%, var(--border-default))`,
            }}
          >
            <span className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl" style={{ background: item.color }} />
            <p className="kpi-label truncate relative z-10">{item.label}</p>
            {item.value !== null ? (
              <p className="kpi-value mt-1 break-words relative z-10" style={{ color: item.color }}>{formatCurrency(item.value, sym)}</p>
            ) : (
              <p className="text-3xl font-bold mt-1 relative z-10" style={{ color: item.color }}>{item.badge}</p>
            )}
          </div>
        ))}
      </div>

      {/* Bar Chart */}
      {chartData.length > 0 && (
        <div className="card card-p">
          <h3 className="section-title text-base mb-4">Budget vs Actual by Category</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} angle={-30} textAnchor="end" />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} tickFormatter={v => `${sym}${(v/1000).toFixed(0)}K`} />
              <Tooltip formatter={(val: number, name: string) => [formatCurrency(val, sym), name === 'budget' ? 'Budget' : 'Actual']} contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: 'var(--shadow-lg)', fontSize: 12 }} />
              <Bar dataKey="budget" name="Budget" fill="#93c5fd" radius={[4,4,0,0]} />
              <Bar dataKey="actual" name="Actual" radius={[4,4,0,0]}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.status === 'red' ? '#ef4444' : entry.status === 'orange' ? '#f59e0b' : '#22c55e'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Budget Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {budgetStatuses.length === 0 && (
          <div className="col-span-full card card-p text-center py-10">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No budgets configured. Add budgets for each spending category.</p>
          </div>
        )}
        {budgetStatuses.map(bs => {
          const pct = bs.monthly_budget > 0 ? Math.min(100, (bs.actual_till_date / bs.monthly_budget) * 100) : 0;
          return (
            <div
              key={bs.category}
              className="card card-p group relative overflow-hidden"
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="flex-shrink-0">
                      {bs.status === 'green' ? <CheckCircle size={15} className="text-emerald-500" /> : bs.status === 'red' ? <AlertTriangle size={15} className="text-red-500" /> : <TrendingUp size={15} className="text-amber-500" />}
                    </span>
                    <h3 className="font-semibold text-sm truncate">{bs.category}</h3>
                  </div>
                  {bs.budget_entry?.owner_purpose && <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>{bs.budget_entry.owner_purpose}</p>}
                </div>
                <div className="flex gap-1 flex-shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                  {bs.budget_entry && <button onClick={() => openEdit(bs.budget_entry!)} className="btn-icon text-slate-400 hover:text-blue-600"><Pencil size={13}/></button>}
                  {bs.budget_entry && <button onClick={() => handleDelete(bs.budget_entry!)} className="btn-icon text-slate-400 hover:text-red-600"><Trash2 size={13}/></button>}
                </div>
              </div>
              <div className="space-y-2 text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
                <div className="flex justify-between gap-2">
                  <span className="min-w-0 truncate">Monthly Budget</span>
                  <span className="font-semibold whitespace-nowrap flex-shrink-0" style={{ color: 'var(--text-primary)' }}>{formatCurrency(bs.monthly_budget, sym)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="min-w-0 truncate">Allowed till Day {bs.days_elapsed}</span>
                  <span className="whitespace-nowrap flex-shrink-0">{formatCurrency(bs.allowed_till_date, sym)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="min-w-0 truncate">Actual Spent</span>
                  <span className={`font-semibold whitespace-nowrap flex-shrink-0 ${bs.status === 'red' ? 'text-red-500' : bs.status === 'orange' ? 'text-amber-600' : 'text-emerald-600'}`}>{formatCurrency(bs.actual_till_date, sym)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="min-w-0 truncate">Remaining</span>
                  <span className={`whitespace-nowrap flex-shrink-0 ${bs.remaining_monthly < 0 ? 'text-red-500 font-bold' : 'text-emerald-600 font-medium'}`}>{formatCurrency(bs.remaining_monthly, sym)}</span>
                </div>
                {bs.days_remaining > 3 && bs.monthly_budget > 0 && (
                  <div className="flex justify-between items-center gap-2">
                    <span className="min-w-0 truncate">Projected Month-End</span>
                    <span className="flex items-center gap-1 flex-shrink-0">
                      <span className={`font-semibold whitespace-nowrap ${bs.projected_month_end > bs.monthly_budget ? 'text-red-500' : 'text-emerald-600'}`}>
                        {formatCurrency(bs.projected_month_end, sym)}
                      </span>
                      {bs.projected_month_end > bs.monthly_budget
                        ? <span className="text-[10px] font-semibold text-red-500 bg-red-50 dark:bg-red-900/20 px-1 py-0.5 rounded whitespace-nowrap">⚠ Over</span>
                        : <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 px-1 py-0.5 rounded whitespace-nowrap">✓ OK</span>
                      }
                    </span>
                  </div>
                )}
                {bs.overspent > 0 && (
                  <div className="flex justify-between gap-2 text-red-500 font-medium">
                    <span className="min-w-0 truncate">Overspent</span>
                    <span className="whitespace-nowrap flex-shrink-0">{formatCurrency(bs.overspent, sym)}</span>
                  </div>
                )}
                {bs.recovery_per_day > 0 && (
                  <div className="flex justify-between gap-2 text-amber-600">
                    <span className="flex-shrink-0">Recovery needed</span>
                    <span className="min-w-0 text-right break-words">{formatCurrency(bs.recovery_per_day, sym)}/day over {bs.days_remaining} days</span>
                  </div>
                )}
              </div>
              <div className="progress-bar">
                <div className={`progress-fill ${bs.status === 'green' ? 'bg-emerald-500' : bs.status === 'red' ? 'bg-red-500' : 'bg-amber-500'}`} style={{ width: `${pct}%` }} />
              </div>
              <div className="flex items-center justify-between gap-2 mt-2">
                <span className="text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{pct.toFixed(0)}% used</span>
                <span className={`badge text-[10px] flex-shrink-0 ${bs.status === 'green' ? 'badge-green' : bs.status === 'red' ? 'badge-red' : 'badge-yellow'}`}>
                  {bs.status === 'green' ? 'On Track' : bs.status === 'red' ? 'Over Budget' : 'Watch Out'}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'var(--bg-overlay)' }}>
          <div className="card w-full max-w-md max-h-[90vh] overflow-y-auto animate-fade-in-up">
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-700">
              <h2 className="text-lg font-semibold">{editing ? 'Edit Budget' : 'Add Budget'}</h2>
              <button onClick={() => setShowForm(false)} className="btn-icon"><X size={18}/></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="form-group">
                <label className="form-label">Category *</label>
                <select className="form-select" value={form.category} onChange={e => setForm({...form, category: e.target.value})} disabled={!!editing}>
                  <option value="">Select…</option>
                  {expenseCategories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Monthly Budget Amount *</label>
                <input type="number" className="form-input" placeholder="0" value={form.monthly_budget || ''} onChange={e => { const n = parseFloat(e.target.value); setForm({ ...form, monthly_budget: Number.isFinite(n) ? n : 0 }); }} min="0" step="1" />
                {form.monthly_budget > 0 && (
                  <p className="form-hint">Daily budget: {formatCurrency(form.monthly_budget / getDaysInMonth(new Date(selYear, selMonth - 1)), currencySymbol(base))}/day</p>
                )}
              </div>
              <div className="form-group">
                <label className="form-label">Owner / Purpose (optional)</label>
                <select className="form-select" value={form.owner_purpose} onChange={e => setForm({...form, owner_purpose: e.target.value})}>
                  <option value="">Any / All</option>
                  {activeOwners.map(o => <option key={o.id} value={o.name}>{o.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Notes</label>
                <textarea className="form-textarea" placeholder="Optional" value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} rows={2} />
              </div>
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input type="checkbox" className="w-4 h-4 accent-blue-600" checked={form.include_in_budget} onChange={e => setForm({...form, include_in_budget: e.target.checked})} />
                Include in Budget Tracking
              </label>
            </div>
            <div className="p-5 border-t border-slate-100 dark:border-slate-700 flex justify-end gap-3">
              <button onClick={() => setShowForm(false)} className="btn-md btn-secondary">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="btn-md btn-primary">
                {saving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/> : <Check size={16}/>}
                {saving ? 'Saving…' : editing ? 'Update' : 'Add Budget'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
