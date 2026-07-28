'use client';
import { useState, useMemo } from 'react';
import { useAppStore } from '@/lib/store/appStore';
import { createClient } from '@/lib/supabase/client';
import { QuickShortcut } from '@/types';
import { formatCurrency, currencySymbol, calculateAccountBalances, checkEntryWarnings } from '@/lib/utils/calculations';
import { useConfirm } from '@/components/ConfirmDialog';
import { isOnline, offlineQueue } from '@/lib/offline';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, X, Check, Zap, Minus } from 'lucide-react';

const TYPES = [{ v: 'expense', l: 'Expense' }, { v: 'transfer', l: 'Transfer' }, { v: 'saving', l: 'Saving' }] as const;

export default function QuickAddPage() {
  const { quickShortcuts, accounts, categories, owners, income, transactions, settings, addQuickShortcut, updateQuickShortcut, removeQuickShortcut, addTransaction } = useAppStore();
  const sb = createClient();
  const confirm = useConfirm();
  const base = settings?.currency ?? 'INR';
  const rates = settings?.exchange_rates;

  const activeAccounts = useMemo(() => accounts.filter(a => a.is_active), [accounts]);
  const nonCcAccounts = useMemo(() => accounts.filter(a => a.is_active && !a.is_credit_card), [accounts]);
  const activeCategories = useMemo(() => categories.filter(c => c.is_active), [categories]);
  const activeOwners = useMemo(() => owners.filter(o => o.is_active), [owners]);
  const balances = useMemo(() => calculateAccountBalances(accounts, income, transactions, rates, base), [accounts, income, transactions, rates, base]);
  const acctName = (id?: string | null) => accounts.find(a => a.id === id)?.name ?? '—';
  const acctSym = (id?: string | null) => currencySymbol(accounts.find(a => a.id === id)?.currency || base);
  const shortcuts = useMemo(() => [...quickShortcuts].sort((a, b) => (a.sort_order - b.sort_order) || a.label.localeCompare(b.label)), [quickShortcuts]);

  // ---------- Run (tap) a shortcut ----------
  const [run, setRun] = useState<{ sc: QuickShortcut; qty: number; amount: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const doAdd = async () => {
    if (!run) return;
    const { sc } = run;
    const q = Math.max(1, Math.round(run.qty || 1));
    // Variable-price shortcut → use the amount typed on tap; otherwise unit × qty.
    const finalAmount = sc.ask_amount ? +(+run.amount || 0).toFixed(2) : +(sc.amount * q).toFixed(2);
    if (!(finalAmount > 0)) { toast.error('Enter an amount greater than 0'); return; }
    setAdding(true);
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) { toast.error('Not authenticated'); return; }
      const today = new Date().toISOString().split('T')[0];
      const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
      const payload = {
        id, date: today, amount: finalAmount, type: sc.type,
        category: sc.category || null,
        owner_purpose: sc.type === 'expense' ? (sc.owner_purpose || null) : null,
        from_account_id: sc.from_account_id || null,
        to_account_id: sc.type === 'expense' ? null : (sc.to_account_id || null),
        description: (!sc.ask_amount && q > 1) ? `${q} × ${sc.label}` : (sc.description || sc.label),
        period: today.slice(0, 7), is_fixed_expense_auto: false, user_id: user.id,
      };
      const warns = checkEntryWarnings(payload, balances, base);
      if (warns.length > 0) {
        const w = warns[0]; const wsym = currencySymbol(w.currency);
        const ok = await confirm({
          title: w.kind === 'overdraft' ? `Overdraw ${w.accountName}?` : `Over ${w.accountName} limit?`,
          message: w.kind === 'overdraft'
            ? `This will take ${w.accountName} to ${formatCurrency(w.projected, wsym)} (currently ${formatCurrency(w.current, wsym)}). Proceed now and adjust later?`
            : `This will put ${w.accountName} at ${formatCurrency(w.projected, wsym)} — over its ${formatCurrency(w.limit ?? 0, wsym)} limit.`,
          confirmLabel: 'Proceed anyway',
        });
        if (!ok) { setAdding(false); return; }
      }
      if (isOnline()) {
        const { data, error } = await sb.from('transactions').insert(payload).select().single();
        if (error) throw error;
        addTransaction(data);
      } else {
        offlineQueue.enqueue({ id, table: 'transactions', payload, createdAt: Date.now() });
        const iso = new Date().toISOString();
        addTransaction({ ...payload, created_at: iso, updated_at: iso } as never);
        toast('Saved offline — will sync when you reconnect', { icon: '📴' });
      }
      toast.success(`Added ${formatCurrency(payload.amount, acctSym(sc.from_account_id))} · ${sc.label}`);
      setRun(null);
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Failed'); } finally { setAdding(false); }
  };

  // ---------- Create / edit a shortcut ----------
  const EMPTY = { label: '', type: 'expense' as QuickShortcut['type'], amount: 0, category: '', owner_purpose: 'Personal', from_account_id: '', to_account_id: '', description: '', color: '#6366f1', ask_amount: false };
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<QuickShortcut | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [savingForm, setSavingForm] = useState(false);
  const openNew = () => { setEditing(null); setForm({ ...EMPTY, from_account_id: nonCcAccounts[0]?.id ?? '', category: activeCategories[0]?.name ?? '', owner_purpose: activeOwners[0]?.name ?? 'Personal' }); setShowForm(true); };
  const openEdit = (sc: QuickShortcut) => { setEditing(sc); setForm({ label: sc.label, type: sc.type, amount: sc.amount, category: sc.category ?? '', owner_purpose: sc.owner_purpose ?? 'Personal', from_account_id: sc.from_account_id ?? '', to_account_id: sc.to_account_id ?? '', description: sc.description ?? '', color: sc.color ?? '#6366f1', ask_amount: sc.ask_amount ?? false }); setShowForm(true); };
  const needsTo = form.type === 'transfer' || form.type === 'saving';
  const fromPool = form.type === 'saving' ? nonCcAccounts : activeAccounts;

  const saveForm = async () => {
    if (!form.label.trim()) { toast.error('Give the shortcut a name'); return; }
    if (!form.ask_amount && !(+form.amount > 0)) { toast.error('Amount must be greater than 0'); return; }
    if (!form.from_account_id) { toast.error('Pick a "From" account'); return; }
    if (needsTo && !form.to_account_id) { toast.error('Pick a destination account'); return; }
    if (needsTo && form.from_account_id === form.to_account_id) { toast.error('From and To must differ'); return; }
    setSavingForm(true);
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) { toast.error('Not authenticated'); return; }
      const payload = {
        label: form.label.trim(), type: form.type, amount: +form.amount || 0, ask_amount: form.ask_amount,
        category: form.category || null,
        owner_purpose: form.type === 'expense' ? (form.owner_purpose || null) : null,
        from_account_id: form.from_account_id || null,
        to_account_id: form.type === 'expense' ? null : (form.to_account_id || null),
        description: form.description || null, color: form.color, user_id: user.id,
      };
      if (editing) {
        const { data, error } = await sb.from('quick_shortcuts').update(payload).eq('id', editing.id).select().single();
        if (error) throw error;
        updateQuickShortcut(editing.id, data);
        toast.success('Shortcut updated');
      } else {
        const { data, error } = await sb.from('quick_shortcuts').insert({ ...payload, sort_order: quickShortcuts.length }).select().single();
        if (error) throw error;
        addQuickShortcut(data);
        toast.success('Shortcut saved');
      }
      setShowForm(false);
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Failed'); } finally { setSavingForm(false); }
  };
  const del = async (sc: QuickShortcut) => {
    if (!(await confirm({ title: 'Delete shortcut?', message: `Delete "${sc.label}"? Your past transactions are kept.`, confirmLabel: 'Delete', danger: true }))) return;
    try { const { error } = await sb.from('quick_shortcuts').delete().eq('id', sc.id); if (error) throw error; removeQuickShortcut(sc.id); toast.success('Shortcut deleted'); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Failed'); }
  };

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Quick Add</h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Save your regulars once — then tap to log them in a second.</p>
        </div>
        <button onClick={openNew} className="btn-md btn-primary"><Plus size={16} /> New shortcut</button>
      </div>

      {shortcuts.length === 0 ? (
        <div className="card card-p text-center py-12">
          <div className="w-12 h-12 rounded-xl mx-auto flex items-center justify-center mb-3" style={{ background: '#6366f11a', color: '#6366f1' }}><Zap size={22} /></div>
          <p className="font-semibold">No shortcuts yet</p>
          <p className="text-sm mt-1 mb-4" style={{ color: 'var(--text-muted)' }}>Create one for the things you log often (e.g. Cigarette ₹25, Fuel, Snacks).</p>
          <button onClick={openNew} className="btn-md btn-primary mx-auto"><Plus size={16} /> New shortcut</button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {shortcuts.map(sc => {
            const color = sc.color || '#6366f1';
            return (
              <div
                key={sc.id}
                onClick={() => setRun({ sc, qty: 1, amount: sc.amount || 0 })}
                className="card card-p relative overflow-hidden group cursor-pointer transition-all duration-200 hover:-translate-y-1 hover:shadow-xl active:scale-[0.99] animate-fade-in-up"
                style={{ background: `color-mix(in srgb, ${color} 12%, var(--bg-surface))`, borderColor: `color-mix(in srgb, ${color} 28%, var(--border-default))` }}
              >
                <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: color }} />
                <div className="relative z-10">
                  <div className="flex items-start justify-between">
                    <span className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${color}24`, color }}><Zap size={18} /></span>
                    <div className="flex gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                      <button onClick={e => { e.stopPropagation(); openEdit(sc); }} aria-label="Edit shortcut" className="btn-icon text-slate-400 hover:text-blue-600"><Pencil size={13} /></button>
                      <button onClick={e => { e.stopPropagation(); del(sc); }} aria-label="Delete shortcut" className="btn-icon text-slate-400 hover:text-red-600"><Trash2 size={13} /></button>
                    </div>
                  </div>
                  <p className="font-semibold text-sm mt-3 truncate">{sc.label}</p>
                  <p className="text-xl font-bold tracking-tight mt-0.5" style={{ color }}>{formatCurrency(sc.amount, acctSym(sc.from_account_id))}</p>
                  <p className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>{sc.type} · {acctName(sc.from_account_id)}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Run (quantity) dialog */}
      {run && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'var(--bg-overlay)' }} onClick={() => !adding && setRun(null)}>
          <div className="card w-full max-w-xs rounded-2xl p-5 animate-fade-in-up" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-semibold text-base truncate">{run.sc.label}</h3>
              <button onClick={() => setRun(null)} className="btn-icon flex-shrink-0"><X size={16} /></button>
            </div>
            <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>{run.sc.type} · {acctName(run.sc.from_account_id)}{run.sc.category ? ` · ${run.sc.category}` : ''}</p>
            {run.sc.ask_amount ? (
              <div className="form-group">
                <label className="form-label text-center">Amount</label>
                <input type="number" autoFocus min="0.01" step="0.01" placeholder="0" value={run.amount || ''} onChange={e => setRun(r => r && ({ ...r, amount: +e.target.value }))} className="form-input text-center text-lg font-bold" />
              </div>
            ) : (
              <div className="flex items-center justify-center gap-4">
                <button onClick={() => setRun(r => r && ({ ...r, qty: Math.max(1, r.qty - 1) }))} className="btn-icon" aria-label="Less"><Minus size={18} /></button>
                <input type="number" min="1" step="1" value={run.qty} onChange={e => setRun(r => r && ({ ...r, qty: Math.max(1, Math.round(+e.target.value || 1)) }))} className="form-input w-20 text-center text-lg font-bold" />
                <button onClick={() => setRun(r => r && ({ ...r, qty: r.qty + 1 }))} className="btn-icon" aria-label="More"><Plus size={18} /></button>
              </div>
            )}
            <p className="text-center text-2xl font-bold my-3" style={{ color: run.sc.color || '#6366f1' }}>{formatCurrency(run.sc.ask_amount ? (run.amount || 0) : run.sc.amount * Math.max(1, run.qty), acctSym(run.sc.from_account_id))}</p>
            <button onClick={doAdd} disabled={adding} className="btn-md btn-primary w-full justify-center">
              {adding ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Check size={16} />}
              {adding ? 'Adding…' : 'Add transaction'}
            </button>
          </div>
        </div>
      )}

      {/* Create / edit shortcut form */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'var(--bg-overlay)' }}>
          <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl animate-fade-in-up" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-700">
              <h2 className="text-lg font-semibold">{editing ? 'Edit shortcut' : 'New shortcut'}</h2>
              <button onClick={() => setShowForm(false)} className="btn-icon"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-3 gap-2">
                {TYPES.map(t => (
                  <button key={t.v} type="button" onClick={() => setForm({ ...form, type: t.v })}
                    className={`px-3 py-2 rounded-lg text-xs font-medium border transition-all ${form.type === t.v ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300'}`}>{t.l}</button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="form-group"><label className="form-label">Name *</label><input type="text" className="form-input" placeholder="e.g. Cigarette" value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} /></div>
                <div className="form-group"><label className="form-label">{form.ask_amount ? 'Default amount' : 'Unit amount *'}</label><input type="number" className="form-input" placeholder="25" min="0" step="0.01" value={form.amount || ''} onChange={e => setForm({ ...form, amount: +e.target.value })} disabled={form.ask_amount} /></div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input type="checkbox" className="w-4 h-4 accent-blue-600" checked={form.ask_amount} onChange={e => setForm({ ...form, ask_amount: e.target.checked })} />
                Ask for the amount each time (variable price — no fixed rate)
              </label>
              <div className="form-group">
                <label className="form-label">{form.type === 'saving' ? 'From (pay with)' : 'From account'} *</label>
                <select className="form-select" value={form.from_account_id} onChange={e => setForm({ ...form, from_account_id: e.target.value })}>
                  <option value="">Select…</option>
                  {fromPool.map(a => <option key={a.id} value={a.id}>{a.name}{a.is_credit_card ? ' (CC)' : ''}</option>)}
                </select>
              </div>
              {needsTo && (
                <div className="form-group">
                  <label className="form-label">{form.type === 'saving' ? 'Save to' : 'To account'} *</label>
                  <select className="form-select" value={form.to_account_id} onChange={e => setForm({ ...form, to_account_id: e.target.value })}>
                    <option value="">Select…</option>
                    {nonCcAccounts.filter(a => a.id !== form.from_account_id).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="form-group"><label className="form-label">Category</label>
                  <select className="form-select" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                    <option value="">—</option>
                    {activeCategories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
                {form.type === 'expense' && (
                  <div className="form-group"><label className="form-label">Owner / Purpose</label>
                    <select className="form-select" value={form.owner_purpose} onChange={e => setForm({ ...form, owner_purpose: e.target.value })}>
                      {activeOwners.map(o => <option key={o.id} value={o.name}>{o.name}</option>)}
                    </select>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="form-group"><label className="form-label">Description</label><input type="text" className="form-input" placeholder="Optional" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
                <div className="form-group"><label className="form-label">Tile colour</label><input type="color" className="form-input h-10" value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} /></div>
              </div>
            </div>
            <div className="p-5 border-t border-slate-100 dark:border-slate-700 flex justify-end gap-3">
              <button onClick={() => setShowForm(false)} className="btn-md btn-secondary">Cancel</button>
              <button onClick={saveForm} disabled={savingForm} className="btn-md btn-primary"><Check size={16} /> {editing ? 'Update' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
