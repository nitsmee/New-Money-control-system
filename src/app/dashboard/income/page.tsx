'use client';
import { useState, useMemo } from 'react';
import { useAppStore } from '@/lib/store/appStore';
import { createClient } from '@/lib/supabase/client';
import { Income } from '@/types';
import { formatCurrency, calculateAccountBalances, accountRole } from '@/lib/utils/calculations';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, X, Check } from 'lucide-react';

const EMPTY: Omit<Income, 'id' | 'user_id' | 'created_at' | 'updated_at'> = {
  date: new Date().toISOString().split('T')[0],
  amount: 0,
  source: '',
  category: '',
  owner_purpose: 'Personal',
  to_account_id: '',
  notes: '',
  include_in_true_income: true,
};

export default function IncomePage() {
  const { income, accounts, categories, owners, incomeSources, addIncome, updateIncome, removeIncome, settings, transactions, addTransaction } = useAppStore();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Income | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [filterMonth, setFilterMonth] = useState(new Date().getMonth() + 1);
  const [filterYear, setFilterYear] = useState(new Date().getFullYear());

  const sb = createClient();
  const sym = settings?.currency_symbol ?? '₹';

  const incomeCategories = useMemo(() => categories.filter(c => (c.type === 'income' || c.type === 'all') && c.is_active), [categories]);
  const activeAccounts = useMemo(() => accounts.filter(a => a.is_active && !a.is_credit_card), [accounts]);
  const activeOwners = useMemo(() => owners.filter(o => o.is_active), [owners]);

  const filtered = useMemo(() => {
    const start = `${filterYear}-${String(filterMonth).padStart(2, '0')}-01`;
    const end = `${filterYear}-${String(filterMonth).padStart(2, '0')}-31`;
    return income.filter(i => i.date >= start && i.date <= end).sort((a, b) => b.date.localeCompare(a.date));
  }, [income, filterMonth, filterYear]);

  const totalIncome = useMemo(() => filtered.reduce((s, i) => s + i.amount, 0), [filtered]);
  const trueIncome = useMemo(() => filtered.filter(i => i.include_in_true_income).reduce((s, i) => s + i.amount, 0), [filtered]);

  const openNew = () => {
    setEditing(null);
    setForm({ ...EMPTY, category: incomeCategories[0]?.name ?? '', owner_purpose: activeOwners[0]?.name ?? 'Personal', to_account_id: activeAccounts[0]?.id ?? '' });
    setShowForm(true);
  };

  const openEdit = (inc: Income) => {
    setEditing(inc);
    setForm({ date: inc.date, amount: inc.amount, source: inc.source ?? '', category: inc.category, owner_purpose: inc.owner_purpose, to_account_id: inc.to_account_id, notes: inc.notes ?? '', include_in_true_income: inc.include_in_true_income });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.date || !form.amount || !form.category || !form.to_account_id || !form.owner_purpose) {
      toast.error('Please fill all required fields'); return;
    }
    setSaving(true);
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) { toast.error('Not authenticated'); return; }

      const payload = { ...form, amount: +form.amount, user_id: user.id };

      if (editing) {
        const { data, error } = await sb.from('income').update(payload).eq('id', editing.id).select().single();
        if (error) throw error;
        updateIncome(editing.id, data);
        toast.success('Income updated');
      } else {
        // --- Payday sweep prep: before this salary lands, note how much is
        // left over in the destination account from before. On payday we move
        // that leftover into the savings bucket so the salary account resets
        // to just the new salary. ---
        const isSalary = (payload.category || '').toLowerCase().includes('salary');
        const incomePeriod = (payload.date || '').slice(0, 7);
        const nowPeriod = new Date().toISOString().slice(0, 7);
        const savings = accounts.find(a => a.is_active && accountRole(a) === 'savings');
        const alreadySwept = transactions.some(t =>
          t.type === 'saving' &&
          (t.description || '').toLowerCase().startsWith('auto: leftover') &&
          (t.date || '').slice(0, 7) === incomePeriod
        );
        let leftover = 0;
        if (isSalary && incomePeriod === nowPeriod && savings && savings.id !== payload.to_account_id && !alreadySwept) {
          const balsBefore = calculateAccountBalances(accounts, income, transactions);
          leftover = Math.round(balsBefore.find(b => b.account.id === payload.to_account_id)?.balance ?? 0);
        }

        const { data, error } = await sb.from('income').insert(payload).select().single();
        if (error) throw error;
        addIncome(data);
        toast.success('Income added');

        // Run the sweep after the salary is recorded.
        if (leftover > 0 && savings) {
          const fromName = accounts.find(a => a.id === payload.to_account_id)?.name ?? 'your salary account';
          const ok = confirm(`${fromName} still has ${formatCurrency(leftover, sym)} left over from before.\n\nMove it into "${savings.name}" so ${fromName} resets to just your new salary?`);
          if (ok) {
            const sweepRow = {
              user_id: user.id,
              date: payload.date,
              amount: leftover,
              description: `Auto: leftover swept to ${savings.name} — ${incomePeriod}`,
              type: 'saving' as const,
              category: 'Savings',
              owner_purpose: 'Personal',
              from_account_id: payload.to_account_id,
              to_account_id: savings.id,
              is_fixed_expense_auto: false,
              fixed_expense_id: null,
              period: incomePeriod,
            };
            const { data: swData, error: swErr } = await sb.from('transactions').insert(sweepRow).select().single();
            if (swErr) toast.error('Could not sweep leftover: ' + swErr.message);
            else { addTransaction(swData); toast.success(`Swept ${formatCurrency(leftover, sym)} to ${savings.name}`); }
          }
        }
      }
      setShowForm(false);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this income entry?')) return;
    setDeleting(id);
    try {
      const { error } = await sb.from('income').delete().eq('id', id);
      if (error) throw error;
      removeIncome(id);
      toast.success('Deleted');
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDeleting(null);
    }
  };

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Income</h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>All money received — salary, bonus, family, reimbursements</p>
        </div>
        <button onClick={openNew} className="btn-md btn-primary">
          <Plus size={16} /> Add Income
        </button>
      </div>

      {/* Filters & Summary */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <select className="form-select text-sm py-1.5 px-3 w-auto" value={filterMonth} onChange={e => setFilterMonth(+e.target.value)}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select className="form-select text-sm py-1.5 px-3 w-auto" value={filterYear} onChange={e => setFilterYear(+e.target.value)}>
            {[2023, 2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span style={{ color: 'var(--text-muted)' }}>Total: <strong className="amount-positive">{formatCurrency(totalIncome, sym)}</strong></span>
          <span style={{ color: 'var(--text-muted)' }}>True Income: <strong className="text-blue-600">{formatCurrency(trueIncome, sym)}</strong></span>
        </div>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'var(--bg-overlay)' }}>
          <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto animate-fade-in-up">
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-700">
              <h2 className="text-lg font-semibold">{editing ? 'Edit Income' : 'Add Income'}</h2>
              <button onClick={() => setShowForm(false)} className="btn-icon"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="form-group">
                  <label className="form-label">Date *</label>
                  <input type="date" className="form-input" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Amount *</label>
                  <input type="number" className="form-input" placeholder="0" value={form.amount || ''} onChange={e => setForm({ ...form, amount: +e.target.value })} min="0" step="0.01" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="form-group">
                  <label className="form-label">Category *</label>
                  <select className="form-select" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                    <option value="">Select…</option>
                    {incomeCategories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Owner / Purpose *</label>
                  <select className="form-select" value={form.owner_purpose} onChange={e => setForm({ ...form, owner_purpose: e.target.value })}>
                    {activeOwners.map(o => <option key={o.id} value={o.name}>{o.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="form-group">
                  <label className="form-label">Source</label>
                  <input type="text" list="sources" className="form-input" placeholder="e.g. Employer" value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} />
                  <datalist id="sources">{incomeSources.filter(s => s.is_active).map(s => <option key={s.id} value={s.name} />)}</datalist>
                </div>
                <div className="form-group">
                  <label className="form-label">To Account *</label>
                  <select className="form-select" value={form.to_account_id} onChange={e => setForm({ ...form, to_account_id: e.target.value })}>
                    <option value="">Select…</option>
                    {activeAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Notes</label>
                <textarea className="form-textarea" placeholder="Optional notes…" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} />
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer text-sm">
                  <input type="checkbox" className="w-4 h-4 accent-blue-600" checked={form.include_in_true_income} onChange={e => setForm({ ...form, include_in_true_income: e.target.checked })} />
                  <span>Include in True Income</span>
                </label>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>(uncheck for family money, reimbursements)</span>
              </div>
            </div>
            <div className="p-5 border-t border-slate-100 dark:border-slate-700 flex justify-end gap-3">
              <button onClick={() => setShowForm(false)} className="btn-md btn-secondary">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="btn-md btn-primary">
                {saving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Check size={16} />}
                {saving ? 'Saving…' : editing ? 'Update' : 'Add Income'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card">
        <div className="table-container border-0">
          <table className="data-table">
            <thead><tr>
              <th>Date</th><th>Amount</th><th>Category</th><th>Source</th><th>Owner</th><th>To Account</th><th>True Income</th><th>Notes</th><th className="text-right">Actions</th>
            </tr></thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="text-center py-10 text-sm" style={{ color: 'var(--text-muted)' }}>
                  No income entries for this period. Click "Add Income" to get started.
                </td></tr>
              )}
              {filtered.map(inc => {
                const acc = accounts.find(a => a.id === inc.to_account_id);
                return (
                  <tr key={inc.id}>
                    <td className="text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{inc.date}</td>
                    <td><span className="amount-positive font-semibold">{formatCurrency(inc.amount, sym)}</span></td>
                    <td><span className="badge badge-green text-[10px]">{inc.category}</span></td>
                    <td className="text-sm" style={{ color: 'var(--text-secondary)' }}>{inc.source || '—'}</td>
                    <td><span className="badge badge-blue text-[10px]">{inc.owner_purpose}</span></td>
                    <td className="text-sm" style={{ color: 'var(--text-secondary)' }}>{acc?.name ?? '—'}</td>
                    <td>
                      {inc.include_in_true_income
                        ? <span className="badge badge-green text-[10px]">Yes</span>
                        : <span className="badge badge-gray text-[10px]">No</span>}
                    </td>
                    <td className="text-xs max-w-xs truncate" style={{ color: 'var(--text-muted)' }}>{inc.notes || '—'}</td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEdit(inc)} className="btn-icon text-slate-400 hover:text-blue-600"><Pencil size={14} /></button>
                        <button onClick={() => handleDelete(inc.id)} disabled={deleting === inc.id} className="btn-icon text-slate-400 hover:text-red-600">
                          {deleting === inc.id ? <span className="w-3.5 h-3.5 border-2 border-red-300 border-t-red-600 rounded-full animate-spin" /> : <Trash2 size={14} />}
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
    </div>
  );
}
