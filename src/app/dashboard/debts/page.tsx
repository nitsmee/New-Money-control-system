'use client';
import { useState, useMemo } from 'react';
import { useAppStore } from '@/lib/store/appStore';
import { createClient } from '@/lib/supabase/client';
import { Debt } from '@/types';
import { formatCurrency } from '@/lib/utils/calculations';
import { useConfirm } from '@/components/ConfirmDialog';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, X, Check, RotateCcw, ArrowDownLeft, ArrowUpRight, HandCoins } from 'lucide-react';

const OWE = '#f43f5e';   // I owe (rose)
const OWED = '#10b981';  // owed to me (emerald)

export default function DebtsPage() {
  const { debts, accounts, settings, addDebt, updateDebt, removeDebt, addTransaction, addIncome } = useAppStore();
  const sb = createClient();
  const confirm = useConfirm();
  const sym = settings?.currency_symbol ?? '₹';
  const base = settings?.currency ?? 'INR';
  const nonCcAccounts = useMemo(() => accounts.filter(a => a.is_active && !a.is_credit_card), [accounts]);

  const sorted = useMemo(() => [...debts].sort((a, b) =>
    (Number(a.is_settled) - Number(b.is_settled)) || b.date.localeCompare(a.date) || (b.created_at || '').localeCompare(a.created_at || '')
  ), [debts]);
  const open = sorted.filter(d => !d.is_settled);
  const settled = sorted.filter(d => d.is_settled);

  const totalOwe = useMemo(() => open.filter(d => d.direction === 'i_owe').reduce((s, d) => s + d.amount, 0), [open]);
  const totalOwed = useMemo(() => open.filter(d => d.direction === 'owed_to_me').reduce((s, d) => s + d.amount, 0), [open]);
  const net = totalOwed - totalOwe;

  // ---------- form ----------
  const EMPTY = { direction: 'i_owe' as Debt['direction'], person: '', amount: 0, description: '', date: new Date().toISOString().split('T')[0] };
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Debt | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const openNew = () => { setEditing(null); setForm({ ...EMPTY }); setShowForm(true); };
  const openEdit = (d: Debt) => { setEditing(d); setForm({ direction: d.direction, person: d.person, amount: d.amount, description: d.description ?? '', date: d.date }); setShowForm(true); };

  const save = async () => {
    if (!form.person.trim()) { toast.error('Enter a name'); return; }
    if (!(+form.amount > 0)) { toast.error('Amount must be greater than 0'); return; }
    setSaving(true);
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) { toast.error('Not authenticated'); return; }
      const payload = { direction: form.direction, person: form.person.trim(), amount: +form.amount, description: form.description || null, date: form.date, currency: base, user_id: user.id };
      if (editing) {
        const { data, error } = await sb.from('debts').update(payload).eq('id', editing.id).select().single();
        if (error) throw error;
        updateDebt(editing.id, data);
        toast.success('Updated');
      } else {
        const { data, error } = await sb.from('debts').insert({ ...payload, is_settled: false }).select().single();
        if (error) throw error;
        addDebt(data);
        toast.success('Added');
      }
      setShowForm(false);
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Failed'); } finally { setSaving(false); }
  };

  const setSettled = async (d: Debt, settledNow: boolean) => {
    try {
      const patch = { is_settled: settledNow, settled_at: settledNow ? new Date().toISOString() : null };
      const { data, error } = await sb.from('debts').update(patch).eq('id', d.id).select().single();
      if (error) throw error;
      updateDebt(d.id, data);
      toast.success(settledNow ? 'Marked settled' : 'Reopened');
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Failed'); }
  };

  // Settle with an optional record of the real money movement (so balances update).
  const [settleFor, setSettleFor] = useState<Debt | null>(null);
  const [settleRecord, setSettleRecord] = useState(true);
  const [settleAcct, setSettleAcct] = useState('');
  const [settling, setSettling] = useState(false);
  const openSettle = (d: Debt) => { setSettleFor(d); setSettleRecord(true); setSettleAcct(nonCcAccounts[0]?.id ?? ''); };
  const doSettle = async () => {
    if (!settleFor) return;
    const d = settleFor;
    setSettling(true);
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) { toast.error('Not authenticated'); return; }
      const today = new Date().toISOString().split('T')[0];
      if (settleRecord && settleAcct) {
        if (d.direction === 'i_owe') {
          const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
          const tx = { id, date: today, amount: d.amount, type: 'expense', category: null, owner_purpose: 'Personal', from_account_id: settleAcct, to_account_id: null, description: `Repaid ${d.person}`, period: today.slice(0, 7), is_fixed_expense_auto: false, user_id: user.id };
          const { data, error } = await sb.from('transactions').insert(tx).select().single();
          if (error) throw error;
          addTransaction(data);
        } else {
          const inc = { date: today, amount: d.amount, source: d.person, category: 'Reimbursement', owner_purpose: 'Personal', to_account_id: settleAcct, notes: `Repayment from ${d.person}`, include_in_true_income: false, period: today.slice(0, 7), user_id: user.id };
          const { data, error } = await sb.from('income').insert(inc).select().single();
          if (error) throw error;
          addIncome(data);
        }
      }
      const { data: dd, error: de } = await sb.from('debts').update({ is_settled: true, settled_at: new Date().toISOString() }).eq('id', d.id).select().single();
      if (de) throw de;
      updateDebt(d.id, dd);
      toast.success(settleRecord && settleAcct ? 'Settled & recorded' : 'Marked settled');
      setSettleFor(null);
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Failed'); } finally { setSettling(false); }
  };
  const del = async (d: Debt) => {
    if (!(await confirm({ title: 'Delete entry?', message: `Delete the ${d.direction === 'i_owe' ? 'amount you owe' : 'amount owed to you by'} ${d.person}?`, confirmLabel: 'Delete', danger: true }))) return;
    try { const { error } = await sb.from('debts').delete().eq('id', d.id); if (error) throw error; removeDebt(d.id); toast.success('Deleted'); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Failed'); }
  };

  const Row = ({ d }: { d: Debt }) => {
    const c = d.direction === 'i_owe' ? OWE : OWED;
    return (
      <div className="card card-p relative overflow-hidden flex items-center gap-3 group" style={{ background: `color-mix(in srgb, ${c} 10%, var(--bg-surface))`, borderColor: `color-mix(in srgb, ${c} 26%, var(--border-default))`, opacity: d.is_settled ? 0.65 : 1 }}>
        <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: c }} />
        <span className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 relative z-10" style={{ background: `${c}24`, color: c }}>
          {d.direction === 'i_owe' ? <ArrowUpRight size={16} /> : <ArrowDownLeft size={16} />}
        </span>
        <div className="min-w-0 flex-1 relative z-10">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-sm truncate">{d.person}</p>
            {d.is_settled && <span className="badge badge-gray text-[10px]">Settled</span>}
          </div>
          {d.description && <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{d.description}</p>}
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{d.date}</p>
        </div>
        <p className="font-bold text-base whitespace-nowrap relative z-10" style={{ color: c }}>{formatCurrency(d.amount, sym)}</p>
        <div className="flex gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity relative z-10">
          {!d.is_settled
            ? <button onClick={() => openSettle(d)} aria-label="Mark settled" className="btn-icon text-slate-400 hover:text-emerald-600"><Check size={15} /></button>
            : <button onClick={() => setSettled(d, false)} aria-label="Reopen" className="btn-icon text-slate-400 hover:text-blue-600"><RotateCcw size={14} /></button>}
          <button onClick={() => openEdit(d)} aria-label="Edit" className="btn-icon text-slate-400 hover:text-blue-600"><Pencil size={13} /></button>
          <button onClick={() => del(d)} aria-label="Delete" className="btn-icon text-slate-400 hover:text-red-600"><Trash2 size={13} /></button>
        </div>
      </div>
    );
  };

  const tile = (label: string, value: number, color: string) => (
    <div className="card card-p relative overflow-hidden" style={{ background: `color-mix(in srgb, ${color} 12%, var(--bg-surface))`, borderColor: `color-mix(in srgb, ${color} 28%, var(--border-default))` }}>
      <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: color }} />
      <p className="kpi-label relative z-10">{label}</p>
      <p className="kpi-value relative z-10" style={{ color }}>{formatCurrency(value, sym)}</p>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Lend &amp; Borrow</h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Track money you owe and money owed to you. Settle when paid.</p>
        </div>
        <button onClick={openNew} className="btn-md btn-primary"><Plus size={16} /> Add entry</button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        {tile('You owe', totalOwe, OWE)}
        {tile('Owed to you', totalOwed, OWED)}
        {tile(net >= 0 ? 'Net (in your favour)' : 'Net (you owe)', Math.abs(net), net >= 0 ? OWED : OWE)}
      </div>

      {debts.length === 0 ? (
        <div className="card card-p text-center py-12">
          <div className="w-12 h-12 rounded-xl mx-auto flex items-center justify-center mb-3" style={{ background: '#6366f11a', color: '#6366f1' }}><HandCoins size={22} /></div>
          <p className="font-semibold">Nothing to track yet</p>
          <p className="text-sm mt-1 mb-4" style={{ color: 'var(--text-muted)' }}>Add an IOU — money you owe someone, or money they owe you.</p>
          <button onClick={openNew} className="btn-md btn-primary mx-auto"><Plus size={16} /> Add entry</button>
        </div>
      ) : (
        <div className="space-y-4">
          {open.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Open</p>
              {open.map(d => <Row key={d.id} d={d} />)}
            </div>
          )}
          {settled.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Settled</p>
              {settled.map(d => <Row key={d.id} d={d} />)}
            </div>
          )}
        </div>
      )}

      {settleFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'var(--bg-overlay)' }} onClick={() => !settling && setSettleFor(null)}>
          <div className="card w-full max-w-sm rounded-2xl animate-fade-in-up" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 pb-3">
              <h2 className="text-lg font-semibold truncate">Settle · {settleFor.person}</h2>
              <button onClick={() => setSettleFor(null)} className="btn-icon flex-shrink-0"><X size={18} /></button>
            </div>
            <div className="px-5 pb-5 space-y-3">
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {settleFor.direction === 'i_owe' ? 'You repay ' : 'You receive '}<strong style={{ color: 'var(--text-primary)' }}>{formatCurrency(settleFor.amount, sym)}</strong>{settleFor.direction === 'i_owe' ? ` to ${settleFor.person}.` : ` from ${settleFor.person}.`}
              </p>
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input type="checkbox" className="w-4 h-4 accent-blue-600" checked={settleRecord} onChange={e => setSettleRecord(e.target.checked)} />
                Also record the money {settleFor.direction === 'i_owe' ? 'leaving' : 'arriving in'} an account
              </label>
              {settleRecord && (
                <div className="form-group">
                  <label className="form-label">{settleFor.direction === 'i_owe' ? 'Paid from' : 'Received into'}</label>
                  <select className="form-select" value={settleAcct} onChange={e => setSettleAcct(e.target.value)}>
                    <option value="">Select account…</option>
                    {nonCcAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  <p className="form-hint">Adds {settleFor.direction === 'i_owe' ? 'an expense' : 'income'} so your balance updates. Untick to just mark it settled.</p>
                </div>
              )}
              <button onClick={doSettle} disabled={settling || (settleRecord && !settleAcct)} className="btn-md btn-primary w-full justify-center">
                {settling ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Check size={16} />}
                {settling ? 'Settling…' : 'Settle'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'var(--bg-overlay)' }}>
          <div className="card w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl animate-fade-in-up" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-700">
              <h2 className="text-lg font-semibold">{editing ? 'Edit entry' : 'Add entry'}</h2>
              <button onClick={() => setShowForm(false)} className="btn-icon"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setForm({ ...form, direction: 'i_owe' })} className={`px-3 py-2 rounded-lg text-sm font-medium border transition-all ${form.direction === 'i_owe' ? 'text-white' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300'}`} style={form.direction === 'i_owe' ? { background: OWE, borderColor: OWE } : undefined}>I owe</button>
                <button type="button" onClick={() => setForm({ ...form, direction: 'owed_to_me' })} className={`px-3 py-2 rounded-lg text-sm font-medium border transition-all ${form.direction === 'owed_to_me' ? 'text-white' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300'}`} style={form.direction === 'owed_to_me' ? { background: OWED, borderColor: OWED } : undefined}>Owed to me</button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="form-group"><label className="form-label">Person *</label><input type="text" className="form-input" placeholder="e.g. Rohit" value={form.person} onChange={e => setForm({ ...form, person: e.target.value })} /></div>
                <div className="form-group"><label className="form-label">Amount *</label><input type="number" className="form-input" placeholder="0" min="0.01" step="0.01" value={form.amount || ''} onChange={e => setForm({ ...form, amount: +e.target.value })} /></div>
              </div>
              <div className="form-group"><label className="form-label">Date</label><input type="date" className="form-input" value={form.date} max={new Date().toISOString().split('T')[0]} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
              <div className="form-group"><label className="form-label">Note</label><input type="text" className="form-input" placeholder="What was it for?" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
            </div>
            <div className="p-5 border-t border-slate-100 dark:border-slate-700 flex justify-end gap-3">
              <button onClick={() => setShowForm(false)} className="btn-md btn-secondary">Cancel</button>
              <button onClick={save} disabled={saving} className="btn-md btn-primary"><Check size={16} /> {editing ? 'Update' : 'Add'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
