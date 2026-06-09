'use client';
import { useState, useMemo } from 'react';
import { useAppStore } from '@/lib/store/appStore';
import { createClient } from '@/lib/supabase/client';
import { Transaction } from '@/types';
import { calculateAccountBalances, accountRole, formatCurrency, formatDate, accountLedger, currencySymbol } from '@/lib/utils/calculations';
import toast from 'react-hot-toast';
import { Plus, X, Check, Receipt, Wallet, PiggyBank, TrendingUp, Users, CreditCard } from 'lucide-react';

type QAType = 'expense' | 'transfer' | 'saving';

const ROLE_META: Record<string, { label: string; badge: string; Icon: any; tint: string }> = {
  cash:        { label: 'Cash',        badge: 'badge-green',  Icon: Wallet,     tint: 'var(--text-success)' },
  savings:     { label: 'Savings',     badge: 'badge-blue',   Icon: PiggyBank,  tint: 'var(--text-primary)' },
  investment:  { label: 'Investment',  badge: 'badge-blue',   Icon: TrendingUp, tint: '#534AB7' },
  family:      { label: 'Family',      badge: 'badge-gray',   Icon: Users,      tint: 'var(--text-primary)' },
  credit_card: { label: 'Credit card', badge: 'badge-red',    Icon: CreditCard, tint: 'var(--text-danger)' },
};

export default function AccountsPage() {
  const { accounts, income, transactions, categories, owners, addTransaction, settings } = useAppStore();
  const sb = createClient();
  const sym = settings?.currency_symbol ?? '₹';

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerView, setDrawerView] = useState<'statement' | 'quickadd'>('statement');
  const [qa, setQa] = useState({
    type: 'expense' as QAType,
    date: new Date().toISOString().split('T')[0],
    amount: 0,
    category: '',
    owner_purpose: 'Personal',
    to_account_id: '',
    description: '',
  });
  const [saving, setSaving] = useState(false);

  const balances = useMemo(() => calculateAccountBalances(accounts, income, transactions), [accounts, income, transactions]);
  const activeBalances = useMemo(() => balances.filter(b => b.account.is_active), [balances]);
  const balOf = (id: string) => balances.find(b => b.account.id === id);

  const expenseCategories = useMemo(() => categories.filter(c => (c.type === 'expense' || c.type === 'transfer' || c.type === 'saving' || c.type === 'all') && c.is_active), [categories]);
  const activeOwners = useMemo(() => owners.filter(o => o.is_active), [owners]);
  const nonCcAccounts = useMemo(() => accounts.filter(a => a.is_active && !a.is_credit_card), [accounts]);

  // Order: cash, savings, investment, family, then credit cards.
  const order: Record<string, number> = { cash: 0, savings: 1, investment: 2, family: 3, credit_card: 4 };
  const sortedBalances = useMemo(() =>
    [...activeBalances].sort((a, b) => (order[accountRole(a.account)] ?? 9) - (order[accountRole(b.account)] ?? 9)),
    [activeBalances]
  );

  const selected = selectedId ? balOf(selectedId) : null;
  const selectedAccount = selected?.account ?? null;

  // Full running-balance statement for the selected account (native currency, oldest → newest).
  const ledger = useMemo(
    () => selectedAccount ? accountLedger(selectedAccount.id, accounts, income, transactions, settings?.exchange_rates, settings?.currency ?? 'INR') : [],
    [selectedAccount, accounts, income, transactions, settings]
  );

  const openAccount = (id: string) => {
    setSelectedId(id);
    setDrawerView('statement');
    setQa({
      type: 'expense',
      date: new Date().toISOString().split('T')[0],
      amount: 0,
      category: expenseCategories[0]?.name ?? '',
      owner_purpose: activeOwners[0]?.name ?? 'Personal',
      to_account_id: '',
      description: '',
    });
  };

  const toOptions = useMemo(() => {
    // For transfer: any other active account. For saving: non-CC accounts (excluding self).
    const pool = qa.type === 'saving' ? nonCcAccounts : accounts.filter(a => a.is_active);
    return pool.filter(a => a.id !== selectedId);
  }, [qa.type, accounts, nonCcAccounts, selectedId]);

  const handleQuickAdd = async () => {
    if (!selectedId) return;
    if (!qa.date || !qa.amount || qa.amount <= 0) { toast.error('Enter a valid amount'); return; }
    if ((qa.type === 'transfer' || qa.type === 'saving') && !qa.to_account_id) { toast.error('Pick a destination account'); return; }
    setSaving(true);
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) { toast.error('Not authenticated'); return; }
      const period = qa.date.slice(0, 7);
      const payload = {
        user_id: user.id,
        date: qa.date,
        amount: +qa.amount,
        type: qa.type,
        description: qa.description || null,
        category: qa.category || null,
        owner_purpose: qa.type === 'expense' ? (qa.owner_purpose || null) : null,
        from_account_id: selectedId,
        to_account_id: qa.type === 'expense' ? null : (qa.to_account_id || null),
        notes: null,
        period,
      };
      const { data, error } = await sb.from('transactions').insert(payload).select().single();
      if (error) throw error;
      addTransaction(data);
      toast.success('Transaction added');
      setQa(q => ({ ...q, amount: 0, description: '' }));
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const displayBalance = (b: ReturnType<typeof balOf>) => {
    if (!b) return 0;
    return b.is_credit_card ? (b.outstanding ?? 0) : b.balance;
  };

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Accounts</h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Tap an account to see its transactions and quickly add a new one</p>
        </div>
      </div>

      {/* Account grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {sortedBalances.length === 0 && (
          <div className="col-span-full card card-p text-center py-10">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No accounts yet. Add accounts in Settings.</p>
          </div>
        )}
        {sortedBalances.map(b => {
          const role = accountRole(b.account);
          const meta = ROLE_META[role] ?? ROLE_META.cash;
          const Icon = meta.Icon;
          const val = displayBalance(b);
          return (
            <button
              key={b.account.id}
              onClick={() => openAccount(b.account.id)}
              className="card card-p text-left transition-transform hover:-translate-y-0.5 hover:shadow-lg"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg" style={{ background: 'var(--bg-subtle, rgba(125,125,125,0.12))' }}>
                    <Icon size={16} style={{ color: meta.tint }} />
                  </span>
                  <div>
                    <p className="font-semibold text-sm leading-tight">{b.account.name}</p>
                    <span className={`badge ${meta.badge} text-[10px]`}>{meta.label}</span>
                  </div>
                </div>
              </div>
              <div className="mt-3">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{b.is_credit_card ? 'Outstanding' : 'Balance'}</p>
                <p className="text-xl font-bold" style={{ color: b.is_credit_card ? 'var(--text-danger)' : 'var(--text-primary)' }}>
                  {formatCurrency(val, sym)}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Detail drawer */}
      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'var(--bg-overlay)' }} onClick={() => setSelectedId(null)}>
          <div className="card h-full w-full max-w-md overflow-y-auto animate-fade-in-up rounded-none" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-700">
              <div>
                <h2 className="text-lg font-semibold">{selected.account.name}</h2>
                <p className="text-sm" style={{ color: selected.is_credit_card ? 'var(--text-danger)' : 'var(--text-secondary)' }}>
                  {selected.is_credit_card ? 'Outstanding ' : 'Balance '}{formatCurrency(displayBalance(selected), sym)}
                </p>
              </div>
              <button onClick={() => setSelectedId(null)} className="btn-icon"><X size={18} /></button>
            </div>

            {/* View toggle: Statement | Quick Add */}
            <div className="p-5 pb-0">
              <div className="inline-flex w-full p-1 rounded-xl gap-1" style={{ background: 'var(--bg-subtle, rgba(125,125,125,0.12))' }}>
                {([
                  { id: 'statement', label: 'Statement', Icon: Receipt },
                  { id: 'quickadd', label: 'Quick Add', Icon: Plus },
                ] as const).map(v => {
                  const VIcon = v.Icon;
                  const active = drawerView === v.id;
                  return (
                    <button
                      key={v.id}
                      onClick={() => setDrawerView(v.id)}
                      className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${active ? 'bg-blue-600 text-white shadow-sm' : 'text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]'}`}
                    >
                      <VIcon size={15} /> {v.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {drawerView === 'quickadd' ? (
            /* Quick add */
            <div className="p-5 space-y-3">
              <div className="flex gap-2">
                {(['expense', 'transfer', 'saving'] as QAType[]).map(t => (
                  <button
                    key={t}
                    onClick={() => setQa(q => ({ ...q, type: t, to_account_id: '' }))}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${qa.type === t ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-200 dark:border-slate-700'}`}
                  >
                    {t === 'expense' ? 'Expense' : t === 'transfer' ? 'Transfer' : 'Saving'}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="form-group">
                  <label className="form-label">Date</label>
                  <input type="date" className="form-input" value={qa.date} onChange={e => setQa({ ...qa, date: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Amount</label>
                  <input type="number" className="form-input" placeholder="0" value={qa.amount || ''} min="0.01" step="0.01" onChange={e => setQa({ ...qa, amount: +e.target.value })} />
                </div>
              </div>

              {(qa.type === 'transfer' || qa.type === 'saving') && (
                <div className="form-group">
                  <label className="form-label">{qa.type === 'saving' ? 'Save to' : 'To account'}</label>
                  <select className="form-select" value={qa.to_account_id} onChange={e => setQa({ ...qa, to_account_id: e.target.value })}>
                    <option value="">Select…</option>
                    {toOptions.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Category</label>
                <select className="form-select" value={qa.category} onChange={e => setQa({ ...qa, category: e.target.value })}>
                  <option value="">{qa.type === 'expense' ? 'Select…' : 'Optional'}</option>
                  {expenseCategories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              </div>

              {qa.type === 'expense' && (
                <div className="form-group">
                  <label className="form-label">Owner / Purpose</label>
                  <select className="form-select" value={qa.owner_purpose} onChange={e => setQa({ ...qa, owner_purpose: e.target.value })}>
                    {activeOwners.map(o => <option key={o.id} value={o.name}>{o.name}</option>)}
                  </select>
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Note</label>
                <input type="text" className="form-input" placeholder="What was this for?" value={qa.description} onChange={e => setQa({ ...qa, description: e.target.value })} />
              </div>

              <button onClick={handleQuickAdd} disabled={saving} className="btn-md btn-primary w-full justify-center">
                {saving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Check size={16} />}
                {saving ? 'Saving…' : `Add ${qa.type}`}
              </button>
            </div>
            ) : (
            /* Full running-balance Statement */
            <div className="p-5">
              {(() => {
                  const base = settings?.currency ?? 'INR';
                  const accSym = currencySymbol(selectedAccount?.currency || base);
                  const isCC = !!selected.is_credit_card;
                  const finalRunning = ledger.length ? ledger[ledger.length - 1].running : 0;
                  const ROW_CAP = 300;
                  const display = [...ledger].reverse(); // newest → oldest, keeping each row's own running
                  const capped = display.length > ROW_CAP;
                  const rows = capped ? display.slice(0, ROW_CAP) : display;
                  return (
                    <>
                      <p className="text-sm font-semibold mb-1">Statement</p>
                      {ledger.length === 0 ? (
                        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No entries for this account yet.</p>
                      ) : (
                        <>
                          <div className="flex items-center flex-wrap gap-x-1.5 gap-y-0.5 text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                            <span>Opening: {formatCurrency(0, accSym)}</span>
                            <span style={{ color: 'var(--text-muted)' }}>→ … →</span>
                            <span className="font-semibold" style={{ color: isCC ? 'var(--text-danger)' : 'var(--text-primary)' }}>
                              Current: {formatCurrency(finalRunning, accSym)}
                            </span>
                          </div>
                          <p className="text-[11px] mb-3" style={{ color: 'var(--text-muted)' }}>
                            This is every entry that affected this account, oldest to newest — the {isCC ? 'Outstanding' : 'Running'} column shows exactly how the current balance was reached.
                          </p>
                          {capped && (
                            <p className="text-[11px] mb-2" style={{ color: 'var(--text-muted)' }}>
                              Showing the most recent {ROW_CAP} of {display.length} entries.
                            </p>
                          )}
                          <div className="overflow-y-auto" style={{ maxHeight: '24rem' }}>
                            <table className="w-full text-xs border-collapse">
                              <thead className="sticky top-0" style={{ background: 'var(--bg-card, var(--bg-surface, #fff))' }}>
                                <tr style={{ color: 'var(--text-muted)' }} className="text-left">
                                  <th className="py-1.5 pr-2 font-medium">Date</th>
                                  <th className="py-1.5 pr-2 font-medium">Description</th>
                                  <th className="py-1.5 pr-2 font-medium text-right">Amount</th>
                                  <th className="py-1.5 font-medium text-right">{isCC ? 'Outstanding' : 'Running'}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {rows.map(e => {
                                  const positive = e.delta >= 0;
                                  return (
                                    <tr key={e.id} className="border-b border-slate-50 dark:border-slate-800 last:border-0 align-top">
                                      <td className="py-1.5 pr-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{formatDate(e.date)}</td>
                                      <td className="py-1.5 pr-2">
                                        <span className="block truncate max-w-[10rem]">{e.label}</span>
                                        <span className="badge badge-gray text-[9px]">{e.type.replace(/_/g, ' ')}</span>
                                      </td>
                                      <td className="py-1.5 pr-2 text-right whitespace-nowrap font-medium" style={{ color: positive ? 'var(--text-success)' : 'var(--text-danger)' }}>
                                        {positive ? '+' : '−'}{formatCurrency(Math.abs(e.delta), accSym)}
                                      </td>
                                      <td className="py-1.5 text-right whitespace-nowrap font-semibold">{formatCurrency(e.running, accSym)}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </>
                      )}
                    </>
                  );
                })()}
            </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
