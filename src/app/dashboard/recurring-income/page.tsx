'use client';
import { useState, useMemo, useEffect } from 'react';
import { useAppStore } from '@/lib/store/appStore';
import { createClient } from '@/lib/supabase/client';
import { RecurringIncome } from '@/types';
import { formatCurrency, safeDueDate, calculateAccountBalances, currencySymbol } from '@/lib/utils/calculations';
import { runAutoProcessIncome } from '@/lib/utils/autoProcessIncome';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, X, Check, RefreshCw } from 'lucide-react';
import { useConfirm } from '@/components/ConfirmDialog';

let recurringIncomePageAutoRan = false;

type FormState = {
  name: string;
  amount: number;
  to_account_id: string;
  category: string;
  due_day: number;
  start_date: string;
  end_date: string;
  include_in_true_income: boolean;
  is_active: boolean;
  notes: string;
};

const EMPTY: FormState = {
  name: '',
  amount: 0,
  to_account_id: '',
  category: 'Salary',
  due_day: 1,
  start_date: new Date().toISOString().split('T')[0],
  end_date: '',
  include_in_true_income: true,
  is_active: true,
  notes: '',
};

function computeNextDue(dueDay: number, startDate: string, endDate: string | null): string | null {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth(); // zero-based

  // Try this month first
  let occStr = safeDueDate(dueDay, year, month);
  if (occStr < today.toISOString().split('T')[0]) {
    // Already passed — use next month
    const nm = month === 11 ? 0 : month + 1;
    const ny = month === 11 ? year + 1 : year;
    occStr = safeDueDate(dueDay, ny, nm);
  }

  if (startDate && occStr < startDate) return null;
  if (endDate && occStr > endDate) return null;
  return occStr;
}

export default function RecurringIncomePage() {
  const {
    recurringIncome, accounts, income, transactions, settings,
    addRecurringIncome, updateRecurringIncome, removeRecurringIncome,
  } = useAppStore();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<RecurringIncome | null>(null);
  const [form, setForm] = useState<FormState>({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const sb = createClient();
  const confirm = useConfirm();
  const sym = settings?.currency_symbol ?? '₹';
  const base = settings?.currency ?? 'INR';
  const rates = settings?.exchange_rates;

  // Current balance of every account (native currency), so each row can show
  // the live "bank balance" the income lands in.
  const balances = useMemo(
    () => calculateAccountBalances(accounts, income, transactions, rates, base),
    [accounts, income, transactions, rates, base]
  );
  const balOf = (id?: string | null) => balances.find(b => b.account.id === id);

  // Auto-process any due recurring income entries on page load.
  useEffect(() => {
    if (recurringIncomePageAutoRan || recurringIncome.length === 0) return;
    recurringIncomePageAutoRan = true;
    (async () => {
      try {
        const { data: { user } } = await sb.auth.getUser();
        if (!user) return;
        const state = useAppStore.getState();
        const r = await runAutoProcessIncome(sb, state.recurringIncome, user.id);
        if (r.processed > 0) {
          toast.success(`Auto-processed ${r.processed} recurring income entr${r.processed > 1 ? 'ies' : 'y'}`);
          state.loadAll(user.id);
        }
      } catch { /* stay silent */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recurringIncome.length]);

  // Non-CC active accounts for income destination
  const eligibleAccounts = useMemo(
    () => accounts.filter(a => a.is_active && !a.is_credit_card),
    [accounts]
  );

  const active = useMemo(() => recurringIncome.filter(r => r.is_active), [recurringIncome]);
  const inactive = useMemo(() => recurringIncome.filter(r => !r.is_active), [recurringIncome]);

  const openNew = () => {
    setEditing(null);
    setForm({ ...EMPTY, to_account_id: eligibleAccounts[0]?.id ?? '' });
    setShowForm(true);
  };

  const openEdit = (ri: RecurringIncome) => {
    setEditing(ri);
    setForm({
      name: ri.name,
      amount: ri.amount,
      to_account_id: ri.to_account_id ?? '',
      category: ri.category,
      due_day: ri.due_day,
      start_date: ri.start_date,
      end_date: ri.end_date ?? '',
      include_in_true_income: ri.include_in_true_income,
      is_active: ri.is_active,
      notes: ri.notes ?? '',
    });
    setShowForm(true);
  };

  const validate = (): boolean => {
    if (!form.name.trim()) { toast.error('Name is required'); return false; }
    if (!form.amount || form.amount <= 0) { toast.error('Amount must be greater than 0'); return false; }
    if (!form.due_day || form.due_day < 1 || form.due_day > 28) { toast.error('Due day must be between 1 and 28'); return false; }
    if (!form.start_date) { toast.error('Start date is required'); return false; }
    return true;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) { toast.error('Not authenticated'); return; }

      const payload = {
        name: form.name.trim(),
        amount: +form.amount,
        to_account_id: form.to_account_id || null,
        category: form.category || 'Salary',
        due_day: +form.due_day,
        start_date: form.start_date,
        end_date: form.end_date || null,
        include_in_true_income: form.include_in_true_income,
        is_active: form.is_active,
        notes: form.notes || null,
        user_id: user.id,
      };

      if (editing) {
        const { data, error } = await sb
          .from('recurring_income')
          .update(payload)
          .eq('id', editing.id)
          .select()
          .single();
        if (error) throw error;
        updateRecurringIncome(editing.id, data);
        toast.success('Recurring income updated');
      } else {
        const { data, error } = await sb
          .from('recurring_income')
          .insert(payload)
          .select()
          .single();
        if (error) throw error;
        addRecurringIncome(data);
        toast.success('Recurring income added');
      }
      setShowForm(false);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (ri: RecurringIncome) => {
    if (!(await confirm({ title:'Delete recurring income?', message:`Delete "${ri.name}"? This cannot be undone.`, confirmLabel:'Delete', danger:true }))) return;
    setDeleting(ri.id);
    try {
      const { error } = await sb.from('recurring_income').delete().eq('id', ri.id);
      if (error) throw error;
      removeRecurringIncome(ri.id);
      toast.success('Deleted');
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDeleting(null);
    }
  };

  const totalActive = useMemo(() => active.reduce((s, r) => s + r.amount, 0), [active]);

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Recurring Income</h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Salary, rental, and other regular income sources expected each month.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {active.length > 0 && (
            <span className="hidden sm:inline text-xs" style={{ color: 'var(--text-muted)' }}>
              Monthly: <strong className="text-green-600">{formatCurrency(totalActive, sym)}</strong>
            </span>
          )}
          <button onClick={openNew} className="btn-md btn-primary">
            <Plus size={16} /> Add Recurring Income
          </button>
        </div>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'var(--bg-overlay)' }}>
          <div className="card w-full max-w-xl max-h-[92vh] overflow-y-auto animate-fade-in-up">
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-700">
              <h2 className="text-lg font-semibold">
                {editing ? 'Edit Recurring Income' : 'Add Recurring Income'}
              </h2>
              <button onClick={() => setShowForm(false)} className="btn-icon"><X size={18} /></button>
            </div>

            <div className="p-5 space-y-4">
              <div className="form-group">
                <label className="form-label">Name *</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Monthly Salary, Rental Income"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="form-group">
                  <label className="form-label">Amount *</label>
                  <input
                    type="number"
                    className="form-input"
                    placeholder="0.00"
                    value={form.amount || ''}
                    onChange={e => setForm({ ...form, amount: +e.target.value })}
                    min="0.01"
                    step="0.01"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Due Day (1–28) *</label>
                  <input
                    type="number"
                    className="form-input"
                    placeholder="1"
                    value={form.due_day}
                    onChange={e => setForm({ ...form, due_day: +e.target.value })}
                    min="1"
                    max="28"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="form-group">
                  <label className="form-label">To Account</label>
                  <select
                    className="form-select"
                    value={form.to_account_id}
                    onChange={e => setForm({ ...form, to_account_id: e.target.value })}
                  >
                    <option value="">Select account…</option>
                    {eligibleAccounts.map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Category</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Salary"
                    value={form.category}
                    onChange={e => setForm({ ...form, category: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="form-group">
                  <label className="form-label">Start Date *</label>
                  <input
                    type="date"
                    className="form-input"
                    value={form.start_date}
                    onChange={e => setForm({ ...form, start_date: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">End Date (optional)</label>
                  <input
                    type="date"
                    className="form-input"
                    value={form.end_date}
                    onChange={e => setForm({ ...form, end_date: e.target.value })}
                  />
                  <p className="form-hint">Leave blank for ongoing</p>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Notes</label>
                <textarea
                  className="form-textarea"
                  placeholder="Optional notes…"
                  value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                />
              </div>

              <div className="flex flex-wrap items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-blue-600"
                    checked={form.include_in_true_income}
                    onChange={e => setForm({ ...form, include_in_true_income: e.target.checked })}
                  />
                  Include in True Income
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-blue-600"
                    checked={form.is_active}
                    onChange={e => setForm({ ...form, is_active: e.target.checked })}
                  />
                  Is Active
                </label>
              </div>
            </div>

            <div className="p-5 border-t border-slate-100 dark:border-slate-700 flex justify-end gap-3">
              <button onClick={() => setShowForm(false)} className="btn-md btn-secondary">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="btn-md btn-primary">
                {saving
                  ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  : <Check size={16} />}
                {saving ? 'Saving…' : editing ? 'Update' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      {active.length === 0 && inactive.length === 0 ? (
        <div className="card card-p text-center py-16">
          <RefreshCw size={36} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-muted)' }}>No recurring income set up yet</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Add salary, rental, or other regular income sources.</p>
          <button onClick={openNew} className="btn-md btn-primary mt-4 inline-flex">
            <Plus size={16} /> Add Recurring Income
          </button>
        </div>
      ) : (
        <div className="card">
          <div className="table-container border-0">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="text-right">Amount</th>
                  <th>Account</th>
                  <th>Category</th>
                  <th className="text-center">Due Day</th>
                  <th>Next Due</th>
                  <th className="text-center">True Income</th>
                  <th className="text-center">Active</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {[...active, ...inactive].map(ri => {
                  const toAcc = accounts.find(a => a.id === ri.to_account_id);
                  // Live balance of the account this income lands in (native currency).
                  const toBal = balOf(ri.to_account_id);
                  const nextDue = ri.is_active
                    ? computeNextDue(ri.due_day, ri.start_date, ri.end_date)
                    : null;
                  const isExpired = !!ri.end_date && ri.end_date < new Date().toISOString().split('T')[0];

                  return (
                    <tr key={ri.id} className={!ri.is_active ? 'opacity-50' : ''}>
                      <td className="font-medium text-sm">{ri.name}</td>
                      <td className="text-right font-semibold text-sm text-green-600 dark:text-green-400">
                        {formatCurrency(ri.amount, sym)}
                      </td>
                      <td className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {toAcc?.name ?? '—'}
                        {toAcc && toBal && (
                          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                            Into {toAcc.name} · bal {formatCurrency(toBal.is_credit_card ? (toBal.outstanding ?? 0) : toBal.balance, currencySymbol(toAcc.currency || base))}
                          </div>
                        )}
                      </td>
                      <td className="text-xs">{ri.category}</td>
                      <td className="text-center text-xs">
                        {ri.due_day}{ri.due_day === 1 ? 'st' : ri.due_day === 2 ? 'nd' : ri.due_day === 3 ? 'rd' : 'th'}
                      </td>
                      <td className="text-xs whitespace-nowrap">
                        {isExpired
                          ? <span className="badge badge-gray text-[10px]">Ended</span>
                          : nextDue
                            ? <span className="text-blue-600 dark:text-blue-400 font-medium">{nextDue}</span>
                            : '—'}
                      </td>
                      <td className="text-center text-xs">
                        {ri.include_in_true_income
                          ? <span className="badge badge-green text-[10px]">Yes</span>
                          : <span className="badge badge-gray text-[10px]">No</span>}
                      </td>
                      <td className="text-center text-xs">
                        {ri.is_active
                          ? <span className="badge badge-green text-[10px]">Active</span>
                          : <span className="badge badge-gray text-[10px]">Inactive</span>}
                      </td>
                      <td>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEdit(ri)}
                            className="btn-icon text-slate-400 hover:text-blue-600"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => handleDelete(ri)}
                            disabled={deleting === ri.id}
                            className="btn-icon text-slate-400 hover:text-red-600"
                          >
                            {deleting === ri.id
                              ? <span className="w-3.5 h-3.5 border-2 border-red-300 border-t-red-600 rounded-full animate-spin" />
                              : <Trash2 size={14} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
