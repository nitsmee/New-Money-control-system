'use client';
import { useState, useMemo, useEffect, useRef } from 'react';
import { useAppStore } from '@/lib/store/appStore';
import { createClient } from '@/lib/supabase/client';
import { FixedExpense, FixedExpenseType } from '@/types';
import { formatCurrency, getCurrentPeriod, nextDueDate, formatDate, calculateAccountBalances, currencySymbol } from '@/lib/utils/calculations';
import { runAutoProcess } from '@/lib/utils/autoProcess';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, X, Check, Play, AlertTriangle, Calendar, Zap } from 'lucide-react';

const FIXED_TYPES: { value: FixedExpenseType; label: string }[] = [
  { value: 'expense', label: 'Expense' },
  { value: 'saving', label: 'Saving / Investment' },
  { value: 'investment', label: 'Long-term Investment' },
  { value: 'transfer', label: 'Transfer' },
];

const EMPTY: Omit<FixedExpense, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'last_processed_period'> = {
  name: '', amount: 0, type: 'expense', category: '', owner_purpose: '',
  from_account_id: '', to_account_id: '', due_day: 1,
  start_date: new Date().toISOString().split('T')[0],
  end_date: undefined, is_active: true, auto_count: true, notes: '', sort_order: 0,
};

export default function FixedExpensesPage() {
  const {
    fixedExpenses, accounts, categories, owners, income, transactions, isLoading,
    addFixedExpense, updateFixedExpense, removeFixedExpense, addTransaction, settings,
  } = useAppStore();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<FixedExpense | null>(null);
  const [form, setForm] = useState<typeof EMPTY>({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);
  const sb = createClient();
  const sym = settings?.currency_symbol ?? '₹';
  const base = settings?.currency ?? 'INR';
  const rates = settings?.exchange_rates;
  const today = new Date();
  const currentPeriod = getCurrentPeriod();

  // Current balance of every account (native currency), so each card can show
  // the live "bank balance" the expense is paid from.
  const balances = useMemo(
    () => calculateAccountBalances(accounts, income, transactions, rates, base),
    [accounts, income, transactions, rates, base]
  );
  const balOf = (id?: string | null) => balances.find(b => b.account.id === id);

  const activeAccounts = useMemo(() => accounts.filter(a => a.is_active), [accounts]);
  const nonCcAccounts = useMemo(() => accounts.filter(a => a.is_active && !a.is_credit_card), [accounts]);
  const expCats = useMemo(() => categories.filter(c => c.is_active), [categories]);
  const activeOwners = useMemo(() => owners.filter(o => o.is_active), [owners]);

  const active = useMemo(() => fixedExpenses.filter(fe => fe.is_active).sort((a, b) => a.due_day - b.due_day), [fixedExpenses]);
  const inactive = useMemo(() => fixedExpenses.filter(fe => !fe.is_active), [fixedExpenses]);

  // Split the monthly total by type so savings/investments aren't lumped in with spend.
  const totals = useMemo(() => {
    const t = { expense: 0, saving: 0, investment: 0, transfer: 0, all: 0 };
    active.forEach(fe => {
      if (fe.end_date && new Date(fe.end_date) < today) return;
      t[fe.type] += fe.amount;
      t.all += fe.amount;
    });
    return t;
  }, [active, today]);

  // ---- Auto-processing: back-fill missed months + post newly-due ones ----
  const runCatchUp = async (opts?: { confirmLarge?: boolean; silent?: boolean }) => {
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      // Read the freshest data straight from the store to avoid stale closures.
      const state = useAppStore.getState();
      const res = await runAutoProcess({
        userId: user.id,
        fixedExpenses: state.fixedExpenses,
        transactions: state.transactions,
        sb,
        addTransaction: state.addTransaction,
        updateFixedExpense: state.updateFixedExpense,
        asOf: new Date(),
        confirmBatch: opts?.confirmLarge
          ? ({ name, count, amount }) =>
              window.confirm(`"${name}" has ${count} unposted past months. Create ${count} entries totalling ${formatCurrency(amount, sym)} now?`)
          : undefined,
      });
      if (!opts?.silent) {
        if (res.created > 0) toast.success(`Posted ${res.created} entr${res.created === 1 ? 'y' : 'ies'} · ${formatCurrency(res.totalAmount, sym)}`);
        res.errors.forEach(e => toast.error(e));
      }
      return res;
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  // Run a catch-up once when data has finished loading.
  const ranRef = useRef(false);
  useEffect(() => {
    if (isLoading || ranRef.current) return;
    ranRef.current = true;
    runCatchUp({ silent: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  const openNew = () => {
    setEditing(null);
    setForm({ ...EMPTY, from_account_id: activeAccounts[0]?.id ?? '', category: expCats[0]?.name ?? '', owner_purpose: activeOwners[0]?.name ?? 'Personal' });
    setShowForm(true);
  };

  const openEdit = (fe: FixedExpense) => {
    setEditing(fe);
    setForm({ name: fe.name, amount: fe.amount, type: fe.type, category: fe.category ?? '', owner_purpose: fe.owner_purpose ?? '', from_account_id: fe.from_account_id ?? '', to_account_id: fe.to_account_id ?? '', due_day: fe.due_day, start_date: fe.start_date, end_date: fe.end_date ?? '', is_active: fe.is_active, auto_count: fe.auto_count, notes: fe.notes ?? '', sort_order: fe.sort_order });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name || !form.amount || !form.due_day) { toast.error('Name, amount, and due day are required'); return; }
    if (form.due_day < 1 || form.due_day > 31) { toast.error('Due day must be between 1 and 31'); return; }
    if (!form.from_account_id) { toast.error('Please select a "From Account"'); return; }
    if ((form.type === 'saving' || form.type === 'investment' || form.type === 'transfer') && !form.to_account_id) {
      toast.error('Please select a "To Account" — savings/investments must land in an account'); return;
    }
    if ((form.type === 'saving' || form.type === 'investment' || form.type === 'transfer') && form.from_account_id === form.to_account_id) {
      toast.error('From and To accounts must be different'); return;
    }
    setSaving(true);
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      const payload = { ...form, amount: +form.amount, due_day: +form.due_day, user_id: user.id, from_account_id: form.from_account_id || null, to_account_id: form.to_account_id || null, end_date: form.end_date || null };
      if (editing) {
        const { data, error } = await sb.from('fixed_expenses').update(payload).eq('id', editing.id).select().single();
        if (error) throw error;
        updateFixedExpense(editing.id, data);
        toast.success('Fixed expense updated');
      } else {
        const { data, error } = await sb.from('fixed_expenses').insert(payload).select().single();
        if (error) throw error;
        addFixedExpense(data);
        toast.success('Fixed expense added');
      }
      setShowForm(false);
      // Immediately back-fill / post any due entries for the saved expense.
      await runCatchUp({ confirmLarge: true });
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  // Manually post a single fixed expense's due entries (back-fills + dedupes).
  const processNow = async (fe: FixedExpense) => {
    if (fe.end_date && new Date(fe.end_date) < today) { toast.error('This fixed expense has ended'); return; }
    setProcessing(fe.id);
    try {
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
        onlyId: fe.id,
      });
      if (res && res.created > 0) toast.success(`${fe.name}: posted ${res.created} entr${res.created === 1 ? 'y' : 'ies'}`);
      else toast.success(`${fe.name} is already up to date`);
      res?.errors.forEach(e => toast.error(e));
    } catch (e: any) { toast.error(e.message); } finally { setProcessing(null); }
  };

  const handleDelete = async (fe: FixedExpense) => {
    if (!confirm(`Delete "${fe.name}"? Past transactions already created will remain.`)) return;
    try {
      const { error } = await sb.from('fixed_expenses').delete().eq('id', fe.id);
      if (error) throw error;
      removeFixedExpense(fe.id);
      toast.success('Deleted');
    } catch (e: any) { toast.error(e.message); }
  };

  const isExpired = (fe: FixedExpense) => !!fe.end_date && new Date(fe.end_date) < today;
  const postedThisPeriod = (fe: FixedExpense) => transactions.some(t => t.fixed_expense_id === fe.id && t.period === currentPeriod);

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Fixed Expenses</h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Recurring payments — EMIs, subscriptions, SIPs, bills. Auto-posted on each due date.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
            {totals.expense > 0 && <span>Expenses: <strong className="amount-negative">{formatCurrency(totals.expense, sym)}</strong></span>}
            {totals.saving > 0 && <span>Savings: <strong className="text-blue-600">{formatCurrency(totals.saving, sym)}</strong></span>}
            {totals.investment > 0 && <span>Investments: <strong className="text-purple-600">{formatCurrency(totals.investment, sym)}</strong></span>}
          </div>
          <button onClick={openNew} className="btn-md btn-primary"><Plus size={16} /> Add Fixed Expense</button>
        </div>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'var(--bg-overlay)' }}>
          <div className="card w-full max-w-xl max-h-[92vh] overflow-y-auto animate-fade-in-up">
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-700">
              <h2 className="text-lg font-semibold">{editing ? 'Edit Fixed Expense' : 'Add Fixed Expense'}</h2>
              <button onClick={() => setShowForm(false)} className="btn-icon"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="form-group col-span-2">
                  <label className="form-label">Name *</label>
                  <input type="text" className="form-input" placeholder="e.g. Netflix, EMI, SIP" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Amount *</label>
                  <input type="number" className="form-input" placeholder="0.00" value={form.amount || ''} onChange={e => setForm({ ...form, amount: +e.target.value })} min="0.01" step="0.01" />
                </div>
                <div className="form-group">
                  <label className="form-label">Due Day of Month *</label>
                  <input type="number" className="form-input" placeholder="1-31" value={form.due_day} onChange={e => setForm({ ...form, due_day: +e.target.value })} min="1" max="31" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="form-group">
                  <label className="form-label">Type *</label>
                  <select className="form-select" value={form.type} onChange={e => setForm({ ...form, type: e.target.value as FixedExpenseType })}>
                    {FIXED_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Category</label>
                  <select className="form-select" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                    <option value="">None</option>
                    {expCats.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="form-group">
                  <label className="form-label">From Account *</label>
                  <select className="form-select" value={form.from_account_id} onChange={e => setForm({ ...form, from_account_id: e.target.value })}>
                    <option value="">Select…</option>
                    {activeAccounts.map(a => <option key={a.id} value={a.id}>{a.name}{a.is_credit_card ? ' (CC)' : ''}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">
                    To Account{form.type === 'saving' || form.type === 'investment' || form.type === 'transfer' ? ' *' : ' (optional)'}
                  </label>
                  <select className="form-select" value={form.to_account_id} onChange={e => setForm({ ...form, to_account_id: e.target.value })}>
                    <option value="">{form.type === 'saving' || form.type === 'investment' || form.type === 'transfer' ? 'Select account…' : 'None'}</option>
                    {(form.type === 'saving' || form.type === 'investment' ? nonCcAccounts : activeAccounts).map(a => <option key={a.id} value={a.id}>{a.name}{a.is_credit_card ? ' (CC)' : ''}</option>)}
                  </select>
                  {(form.type === 'saving' || form.type === 'investment') && (
                    <p className="form-hint">Where the money is saved (bank or savings — not a credit card).</p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="form-group">
                  <label className="form-label">Start Date</label>
                  <input type="date" className="form-input" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} />
                  <p className="form-hint">Missed months from this date are back-filled.</p>
                </div>
                <div className="form-group">
                  <label className="form-label">End Date (for EMIs etc.)</label>
                  <input type="date" className="form-input" value={form.end_date ?? ''} onChange={e => setForm({ ...form, end_date: e.target.value || undefined })} />
                  <p className="form-hint">Leave blank for ongoing</p>
                </div>
              </div>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer text-sm">
                  <input type="checkbox" className="w-4 h-4 accent-blue-600" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} />
                  Active
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-sm">
                  <input type="checkbox" className="w-4 h-4 accent-blue-600" checked={form.auto_count} onChange={e => setForm({ ...form, auto_count: e.target.checked })} />
                  Auto-post on due date (recommended)
                </label>
              </div>
              <div className="form-group">
                <label className="form-label">Notes</label>
                <textarea className="form-textarea" placeholder="Optional notes…" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} />
              </div>
            </div>
            <div className="p-5 border-t border-slate-100 dark:border-slate-700 flex justify-end gap-3">
              <button onClick={() => setShowForm(false)} className="btn-md btn-secondary">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="btn-md btn-primary">
                {saving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Check size={16} />}
                {saving ? 'Saving…' : editing ? 'Update' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {active.length === 0 && (
          <div className="col-span-full card card-p text-center py-10">
            <Calendar size={32} className="mx-auto mb-3 text-slate-300" />
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No fixed expenses yet. Add recurring bills, EMIs, or subscriptions.</p>
          </div>
        )}
        {active.map(fe => {
          const fromAcc = accounts.find(a => a.id === fe.from_account_id);
          const toAcc = accounts.find(a => a.id === fe.to_account_id);
          const posted = postedThisPeriod(fe);
          const expired = isExpired(fe);
          const nd = nextDueDate(fe, today);
          // Live balance of the account this expense is paid from (native currency).
          const fromBal = balOf(fe.from_account_id);

          return (
            <div key={fe.id} className={`card card-p group transition-all ${expired ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{fe.name}</h3>
                  <span className={`badge text-[10px] mt-0.5 ${fe.type === 'saving' || fe.type === 'investment' ? 'badge-blue' : 'badge-red'}`}>{fe.type}</span>
                </div>
                <span className="text-lg font-bold amount-negative">{formatCurrency(fe.amount, sym)}</span>
              </div>
              <div className="space-y-1 text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                <div className="flex justify-between"><span>Due day</span><span className="font-medium" style={{ color: 'var(--text-primary)' }}>{fe.due_day}{fe.due_day === 1 ? 'st' : fe.due_day === 2 ? 'nd' : fe.due_day === 3 ? 'rd' : 'th'} of month</span></div>
                {!expired && nd && <div className="flex justify-between"><span>Next due</span><span className="font-medium" style={{ color: 'var(--text-primary)' }}>{formatDate(nd)}</span></div>}
                {fromAcc && <div className="flex justify-between"><span>From</span><span className="font-medium" style={{ color: 'var(--text-primary)' }}>{fromAcc.name}</span></div>}
                {fromAcc && fromBal && (
                  <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    From {fromAcc.name} · {fromBal.is_credit_card ? 'due' : 'bal'} {formatCurrency(fromBal.is_credit_card ? (fromBal.outstanding ?? 0) : fromBal.balance, currencySymbol(fromAcc.currency || base))}
                  </div>
                )}
                {toAcc && <div className="flex justify-between"><span>To</span><span className="font-medium" style={{ color: 'var(--text-primary)' }}>{toAcc.name}</span></div>}
                {fe.category && <div className="flex justify-between"><span>Category</span><span>{fe.category}</span></div>}
                {fe.end_date && <div className="flex justify-between"><span>Ends</span><span className={expired ? 'text-red-500' : 'text-amber-600'}>{fe.end_date}</span></div>}
              </div>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
                <div className="flex items-center gap-1.5">
                  {posted && <span className="badge badge-green text-[10px]"><Check size={10} /> Posted this month</span>}
                  {!posted && !expired && nd && <span className="badge badge-yellow text-[10px]"><AlertTriangle size={10} /> Due {formatDate(nd)}</span>}
                  {expired && <span className="badge badge-gray text-[10px]">Ended</span>}
                  {fe.auto_count && !expired && <span className="badge badge-blue text-[10px]"><Zap size={10} /> Auto</span>}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {!expired && (
                    <button onClick={() => processNow(fe)} disabled={processing === fe.id} className="btn-icon text-emerald-600 hover:bg-emerald-50" title="Post due entries now">
                      {processing === fe.id ? <span className="w-3.5 h-3.5 border-2 border-emerald-300 border-t-emerald-600 rounded-full animate-spin" /> : <Play size={14} />}
                    </button>
                  )}
                  <button onClick={() => openEdit(fe)} className="btn-icon text-slate-400 hover:text-blue-600"><Pencil size={14} /></button>
                  <button onClick={() => handleDelete(fe)} className="btn-icon text-slate-400 hover:text-red-600"><Trash2 size={14} /></button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {inactive.length > 0 && (
        <div>
          <h2 className="text-base font-semibold mb-3" style={{ color: 'var(--text-muted)' }}>Inactive / Expired</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {inactive.map(fe => (
              <div key={fe.id} className="card card-p opacity-50">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium text-sm">{fe.name}</h3>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{formatCurrency(fe.amount, sym)} / month</p>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(fe)} className="btn-icon text-slate-400 hover:text-blue-600"><Pencil size={13} /></button>
                    <button onClick={() => handleDelete(fe)} className="btn-icon text-slate-400 hover:text-red-600"><Trash2 size={13} /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
