'use client';
import { useState, useMemo } from 'react';
import { useAppStore } from '@/lib/store/appStore';
import { createClient } from '@/lib/supabase/client';
import { Transaction, TransactionType, TRANSACTION_TYPES } from '@/types';
import { formatCurrency } from '@/lib/utils/calculations';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, X, Check, Filter } from 'lucide-react';

const EMPTY = {
  date: new Date().toISOString().split('T')[0],
  amount: 0, description: '', type: 'expense' as TransactionType,
  category: '', owner_purpose: 'Personal',
  from_account_id: '', to_account_id: '', notes: '',
};

// Returns which fields are required/visible per transaction type
function getTypeConfig(type: TransactionType) {
  switch (type) {
    case 'expense':
      return { needsFrom: true, needsTo: false, needsOwner: true, needsCat: true, label: 'Expense' };
    case 'transfer':
      return { needsFrom: true, needsTo: true, needsOwner: false, needsCat: true, label: 'Transfer' };
    case 'credit_card_payment':
      return { needsFrom: true, needsTo: true, needsOwner: false, needsCat: false, label: 'CC Payment', fromLabel: 'Bank Account', toLabel: 'Credit Card' };
    case 'saving':
      return { needsFrom: true, needsTo: true, needsOwner: false, needsCat: true, label: 'Saving', toLabel: 'Savings Account' };
    case 'initial_balance':
      return { needsFrom: false, needsTo: true, needsOwner: false, needsCat: false, label: 'Initial Balance' };
    case 'initial_cc_outstanding':
      return { needsFrom: true, needsTo: false, needsOwner: false, needsCat: false, label: 'Initial CC Outstanding', fromLabel: 'Credit Card' };
    case 'adjustment':
      return { needsFrom: false, needsTo: true, needsOwner: false, needsCat: false, label: 'Adjustment' };
    default:
      return { needsFrom: true, needsTo: false, needsOwner: true, needsCat: true, label: 'Transaction' };
  }
}

const TYPE_COLOR: Record<TransactionType, string> = {
  expense: 'badge-red', transfer: 'badge-gray', credit_card_payment: 'badge-yellow',
  saving: 'badge-blue', initial_balance: 'badge-green', initial_cc_outstanding: 'badge-red', adjustment: 'badge-gray',
};

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default function TransactionsPage() {
  const { transactions, accounts, categories, owners, addTransaction, updateTransaction, removeTransaction, settings } = useAppStore();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [filterMonth, setFilterMonth] = useState(new Date().getMonth() + 1);
  const [filterYear, setFilterYear] = useState(new Date().getFullYear());
  const [filterType, setFilterType] = useState<TransactionType | 'all'>('all');
  const sb = createClient();
  const sym = settings?.currency_symbol ?? '₹';

  const cfg = getTypeConfig(form.type);
  const activeAccounts = useMemo(() => accounts.filter(a => a.is_active), [accounts]);
  const ccAccounts = useMemo(() => accounts.filter(a => a.is_active && a.is_credit_card), [accounts]);
  const nonCcAccounts = useMemo(() => accounts.filter(a => a.is_active && !a.is_credit_card), [accounts]);
  const savingsAccounts = useMemo(() => accounts.filter(a => a.is_active && !a.is_credit_card && a.include_in_goal_savings), [accounts]);
  const expenseCategories = useMemo(() => categories.filter(c => (c.type === 'expense' || c.type === 'transfer' || c.type === 'saving' || c.type === 'all') && c.is_active), [categories]);
  const activeOwners = useMemo(() => owners.filter(o => o.is_active), [owners]);

  const filtered = useMemo(() => {
    const start = `${filterYear}-${String(filterMonth).padStart(2, '0')}-01`;
    const end = `${filterYear}-${String(filterMonth).padStart(2, '0')}-31`;
    return transactions
      .filter(t => t.date >= start && t.date <= end && (filterType === 'all' || t.type === filterType))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [transactions, filterMonth, filterYear, filterType]);

  const totals = useMemo(() => ({
    expense: filtered.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0),
    saving: filtered.filter(t => t.type === 'saving').reduce((s, t) => s + t.amount, 0),
    cc_payment: filtered.filter(t => t.type === 'credit_card_payment').reduce((s, t) => s + t.amount, 0),
  }), [filtered]);

  const getFromAccounts = () => {
    if (form.type === 'credit_card_payment') return nonCcAccounts;
    if (form.type === 'initial_cc_outstanding') return ccAccounts;
    if (form.type === 'expense' || form.type === 'saving' || form.type === 'transfer') return activeAccounts;
    return activeAccounts;
  };
  const getToAccounts = () => {
    if (form.type === 'credit_card_payment') return ccAccounts;
    if (form.type === 'saving') return savingsAccounts.length > 0 ? savingsAccounts : nonCcAccounts;
    return activeAccounts;
  };

  const openNew = () => {
    setEditing(null);
    setForm({ ...EMPTY, from_account_id: nonCcAccounts[0]?.id ?? '', category: expenseCategories[0]?.name ?? '', owner_purpose: activeOwners[0]?.name ?? 'Personal' });
    setShowForm(true);
  };
  const openEdit = (tx: Transaction) => {
    setEditing(tx);
    setForm({ date: tx.date, amount: tx.amount, description: tx.description ?? '', type: tx.type, category: tx.category ?? '', owner_purpose: tx.owner_purpose ?? 'Personal', from_account_id: tx.from_account_id ?? '', to_account_id: tx.to_account_id ?? '', notes: tx.notes ?? '' });
    setShowForm(true);
  };

  const validate = () => {
    if (!form.date || !form.amount || form.amount <= 0) { toast.error('Date and amount are required'); return false; }
    if (cfg.needsFrom && !form.from_account_id) { toast.error(`Please select ${cfg.fromLabel ?? 'From Account'}`); return false; }
    if (cfg.needsTo && !form.to_account_id) { toast.error(`Please select ${cfg.toLabel ?? 'To Account'}`); return false; }
    if (form.type === 'credit_card_payment') {
      const toAcc = accounts.find(a => a.id === form.to_account_id);
      if (!toAcc?.is_credit_card) { toast.error('To Account must be a Credit Card for bill payments'); return false; }
    }
    return true;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) { toast.error('Not authenticated'); return; }
      const period = form.date.slice(0, 7);
      const payload = {
        ...form, amount: +form.amount, user_id: user.id, period,
        from_account_id: form.from_account_id || null,
        to_account_id: form.to_account_id || null,
        category: form.category || null,
        owner_purpose: form.owner_purpose || null,
      };
      if (editing) {
        const { data, error } = await sb.from('transactions').update(payload).eq('id', editing.id).select().single();
        if (error) throw error;
        updateTransaction(editing.id, data);
        toast.success('Transaction updated');
      } else {
        const { data, error } = await sb.from('transactions').insert(payload).select().single();
        if (error) throw error;
        addTransaction(data);
        toast.success('Transaction added');
      }
      setShowForm(false);
    } catch (e: any) {
      toast.error(e.message);
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this transaction? This cannot be undone.')) return;
    setDeleting(id);
    try {
      const { error } = await sb.from('transactions').delete().eq('id', id);
      if (error) throw error;
      removeTransaction(id);
      toast.success('Deleted');
    } catch (e: any) { toast.error(e.message); } finally { setDeleting(null); }
  };

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Transactions</h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Daily entries — expenses, transfers, savings, CC payments</p>
        </div>
        <button onClick={openNew} className="btn-md btn-primary"><Plus size={16} /> Add Transaction</button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <select className="form-select text-sm py-1.5 px-3 w-auto" value={filterMonth} onChange={e => setFilterMonth(+e.target.value)}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select className="form-select text-sm py-1.5 px-3 w-auto" value={filterYear} onChange={e => setFilterYear(+e.target.value)}>
            {[2023, 2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select className="form-select text-sm py-1.5 px-3 w-auto" value={filterType} onChange={e => setFilterType(e.target.value as any)}>
            <option value="all">All Types</option>
            {TRANSACTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--text-muted)' }}>
          <span>Expense: <strong className="amount-negative">{formatCurrency(totals.expense, sym)}</strong></span>
          <span>Savings: <strong className="text-blue-600">{formatCurrency(totals.saving, sym)}</strong></span>
          <span>CC Paid: <strong className="text-amber-600">{formatCurrency(totals.cc_payment, sym)}</strong></span>
        </div>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'var(--bg-overlay)' }}>
          <div className="card w-full max-w-2xl max-h-[92vh] overflow-y-auto animate-fade-in-up">
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-700">
              <h2 className="text-lg font-semibold">{editing ? 'Edit Transaction' : 'Add Transaction'}</h2>
              <button onClick={() => setShowForm(false)} className="btn-icon"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              {/* Type selector */}
              <div className="form-group">
                <label className="form-label">Transaction Type *</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {TRANSACTION_TYPES.map(t => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setForm({ ...form, type: t.value, from_account_id: '', to_account_id: '', category: '', owner_purpose: 'Personal' })}
                      className={`px-3 py-2 rounded-lg text-xs font-medium border transition-all ${form.type === t.value ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-blue-300'}`}
                    >{t.label}</button>
                  ))}
                </div>
                {/* Helper text */}
                <p className="form-hint mt-1">
                  {form.type === 'expense' && 'Records money spent. Debits the From Account.'}
                  {form.type === 'transfer' && 'Moves money between accounts (e.g. cash withdrawal). No expense counted.'}
                  {form.type === 'credit_card_payment' && 'Pay a credit card bill. Bank decreases, CC outstanding decreases.'}
                  {form.type === 'saving' && 'Move money to savings. Source decreases, savings increases.'}
                  {form.type === 'initial_balance' && 'Set opening balance for a normal account.'}
                  {form.type === 'initial_cc_outstanding' && 'Set existing credit card balance (what you already owe).'}
                  {form.type === 'adjustment' && 'Manual balance correction.'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="form-group">
                  <label className="form-label">Date *</label>
                  <input type="date" className="form-input" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Amount *</label>
                  <input type="number" className="form-input" placeholder="0.00" value={form.amount || ''} onChange={e => setForm({ ...form, amount: +e.target.value })} min="0.01" step="0.01" />
                </div>
              </div>

              {cfg.needsFrom && (
                <div className="form-group">
                  <label className="form-label">{cfg.fromLabel ?? 'From Account'} *</label>
                  <select className="form-select" value={form.from_account_id} onChange={e => setForm({ ...form, from_account_id: e.target.value })}>
                    <option value="">Select account…</option>
                    {getFromAccounts().map(a => <option key={a.id} value={a.id}>{a.name}{a.is_credit_card ? ' (CC)' : ''}</option>)}
                  </select>
                </div>
              )}

              {cfg.needsTo && (
                <div className="form-group">
                  <label className="form-label">{cfg.toLabel ?? 'To Account'} *</label>
                  <select className="form-select" value={form.to_account_id} onChange={e => setForm({ ...form, to_account_id: e.target.value })}>
                    <option value="">Select account…</option>
                    {getToAccounts().map(a => <option key={a.id} value={a.id}>{a.name}{a.is_credit_card ? ' (CC)' : ''}</option>)}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                {cfg.needsCat && (
                  <div className="form-group">
                    <label className="form-label">Category</label>
                    <select className="form-select" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                      <option value="">Select…</option>
                      {expenseCategories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                    </select>
                  </div>
                )}
                {cfg.needsOwner && (
                  <div className="form-group">
                    <label className="form-label">Owner / Purpose</label>
                    <select className="form-select" value={form.owner_purpose} onChange={e => setForm({ ...form, owner_purpose: e.target.value })}>
                      {activeOwners.map(o => <option key={o.id} value={o.name}>{o.name}</option>)}
                    </select>
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Description</label>
                <input type="text" className="form-input" placeholder="What was this for?" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
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

      {/* Table */}
      <div className="card">
        <div className="table-container border-0">
          <table className="data-table">
            <thead><tr>
              <th>Date</th><th>Description</th><th>Type</th><th>Category</th><th>Owner</th><th>From</th><th>To</th><th className="text-right">Amount</th><th className="text-right">Actions</th>
            </tr></thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="text-center py-10 text-sm" style={{ color: 'var(--text-muted)' }}>
                  No transactions for this period. Click "Add Transaction" to start.
                </td></tr>
              )}
              {filtered.map(tx => {
                const fromAcc = accounts.find(a => a.id === tx.from_account_id);
                const toAcc = accounts.find(a => a.id === tx.to_account_id);
                return (
                  <tr key={tx.id}>
                    <td className="text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{tx.date}</td>
                    <td className="max-w-xs text-sm">{tx.description || tx.category || '—'}</td>
                    <td><span className={`badge text-[10px] ${TYPE_COLOR[tx.type]}`}>{tx.type.replace(/_/g, ' ')}</span></td>
                    <td className="text-xs">{tx.category ?? '—'}</td>
                    <td className="text-xs">{tx.owner_purpose ?? '—'}</td>
                    <td className="text-xs" style={{ color: 'var(--text-secondary)' }}>{fromAcc?.name ?? '—'}</td>
                    <td className="text-xs" style={{ color: 'var(--text-secondary)' }}>{toAcc?.name ?? '—'}</td>
                    <td className={`text-right font-semibold text-sm ${tx.type === 'expense' ? 'amount-negative' : tx.type === 'saving' ? 'text-blue-600 dark:text-blue-400' : 'amount-neutral'}`}>
                      {tx.type === 'expense' ? '-' : ''}{formatCurrency(tx.amount, sym)}
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEdit(tx)} className="btn-icon text-slate-400 hover:text-blue-600"><Pencil size={14} /></button>
                        <button onClick={() => handleDelete(tx.id)} disabled={deleting === tx.id} className="btn-icon text-slate-400 hover:text-red-600">
                          {deleting === tx.id ? <span className="w-3.5 h-3.5 border-2 border-red-300 border-t-red-600 rounded-full animate-spin" /> : <Trash2 size={14} />}
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
